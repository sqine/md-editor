/// macOS PDF 내보내기
///
/// WKWebView.createPDFWithConfiguration:completionHandler: 를
/// objc2 + block2 로 호출한다.
///
/// 비동기 흐름:
///   with_webview 클로저(메인 스레드) → msg_send! → ObjC 런타임이 block 보관
///   → PDF 준비되면 block 호출(백그라운드 큐) → oneshot 채널로 전달
///   → .await 로 수신 → 파일 저장

use std::sync::{Arc, Mutex};
use tauri::WebviewWindow;
use tokio::sync::oneshot;

pub async fn create_pdf(win: &WebviewWindow, output_path: &str) -> Result<(), String> {
    let (tx, rx) = oneshot::channel::<Result<Vec<u8>, String>>();
    // tx를 Arc로 감싸야 RcBlock 클로저가 Clone 바운드를 만족한다.
    // (Arc<Mutex<...>>는 Clone이지만 oneshot::Sender는 Clone이 아님)
    let tx_slot = Arc::new(Mutex::new(Some(tx)));

    win.with_webview({
        let tx_slot = tx_slot.clone();
        move |webview| {
            let tx_slot = tx_slot.clone();
            unsafe { invoke_create_pdf(webview.inner() as *mut std::ffi::c_void, tx_slot) };
        }
    })
    .map_err(|e| format!("with_webview 실패: {e}"))?;

    // 콜백이 완료될 때까지 대기 (최대 30초)
    let bytes = tokio::time::timeout(std::time::Duration::from_secs(30), rx)
        .await
        .map_err(|_| "PDF 생성 타임아웃 (30s)".to_string())?
        .map_err(|_| "PDF 채널 수신 오류".to_string())??;

    std::fs::write(output_path, &bytes)
        .map_err(|e| format!("파일 저장 실패: {e}"))
}

/// 실제 Objective-C 호출부
/// wk_ptr: WKWebView* (id)
unsafe fn invoke_create_pdf(
    wk_ptr: *mut std::ffi::c_void,
    tx_slot: Arc<Mutex<Option<oneshot::Sender<Result<Vec<u8>, String>>>>>,
) {
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2::msg_send;
    use block2::RcBlock;

    let send_err = |msg: String| {
        if let Some(tx) = tx_slot.lock().unwrap().take() {
            let _ = tx.send(Err(msg));
        }
    };

    let wk = wk_ptr as *mut AnyObject;

    // WKPDFConfiguration *config = [WKPDFConfiguration new];
    let config_cls = match AnyClass::get(c"WKPDFConfiguration") {
        Some(c) => c,
        None => {
            send_err("WKPDFConfiguration 클래스를 찾을 수 없음".to_string());
            return;
        }
    };
    let config: *mut AnyObject = msg_send![config_cls, new];

    // completion handler block
    // 시그니처: void (^)(NSData * _Nullable pdfData, NSError * _Nullable error)
    //
    // RcBlock::new()는 closure가 Clone이어야 한다.
    // Arc<Mutex<Option<Sender>>>는 Clone → 조건 만족.
    let tx_slot_for_block = tx_slot.clone();
    let block = RcBlock::new(move |data: *mut AnyObject, error: *mut AnyObject| {
        // 클로저 내부는 unsafe 컨텍스트가 아니므로 ObjC 호출마다 unsafe 블록 필요
        if !data.is_null() {
            let bytes_vec: Vec<u8> = unsafe {
                // bytes() 반환 타입이 objc2-foundation 버전마다 다를 수 있어
                // msg_send!로 직접 호출해 *const u8로 받는다
                let ptr: *const u8 = msg_send![data, bytes];
                let len: usize     = msg_send![data, length];
                std::slice::from_raw_parts(ptr, len).to_vec()
            };
            if let Some(tx) = tx_slot_for_block.lock().unwrap().take() {
                let _ = tx.send(Ok(bytes_vec));
            }
        } else if !error.is_null() {
            let msg: String = unsafe {
                let desc: *mut AnyObject = msg_send![error, localizedDescription];
                let utf8: *const std::ffi::c_char = msg_send![desc, UTF8String];
                if utf8.is_null() {
                    "알 수 없는 PDF 오류".to_string()
                } else {
                    std::ffi::CStr::from_ptr(utf8).to_string_lossy().into_owned()
                }
            };
            if let Some(tx) = tx_slot_for_block.lock().unwrap().take() {
                let _ = tx.send(Err(msg));
            }
        } else if let Some(tx) = tx_slot_for_block.lock().unwrap().take() {
            let _ = tx.send(Err("PDF 데이터와 오류가 모두 nil".to_string()));
        }
    });

    // [wkWebView createPDFWithConfiguration:config completionHandler:block]
    let _: () = msg_send![
        wk,
        createPDFWithConfiguration: config,
        completionHandler: &*block
    ];

    // ObjC 런타임이 block을 retain했으므로 drop해도 안전
    drop(block);
    // config autorelease (ARC 없는 환경 방어)
    let _: () = msg_send![config, release];
}
