/// Windows PDF 내보내기
///
/// Tauri의 with_webview → ICoreWebView2Controller → ICoreWebView2
/// → ICoreWebView2_7::PrintToPdf(path, settings, handler)
///
/// webview2-com 크레이트가 COM 인터페이스 바인딩을 제공한다.
/// handler는 ICoreWebView2PrintToPdfCompletedHandler 구현체를 통해
/// 완료 여부를 oneshot 채널로 전달한다.

use tauri::WebviewWindow;
use tokio::sync::oneshot;
use std::sync::{Arc, Mutex};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2, ICoreWebView2_7,
    ICoreWebView2PrintToPdfCompletedHandler,
    ICoreWebView2PrintToPdfCompletedHandler_Impl,
};
use windows::core::{implement, HSTRING, Result as WinResult, BOOL};

type TxSlot = Arc<Mutex<Option<oneshot::Sender<Result<(), String>>>>>;

fn send_err(slot: &TxSlot, msg: String) {
    if let Some(tx) = slot.lock().unwrap().take() {
        let _ = tx.send(Err(msg));
    }
}

// #[implement] 매크로가 안정적으로 동작하려면 모듈 최상위에 struct를 정의해야 한다
#[implement(ICoreWebView2PrintToPdfCompletedHandler)]
struct PdfHandler {
    tx: TxSlot,
}

impl ICoreWebView2PrintToPdfCompletedHandler_Impl for PdfHandler_Impl {
    fn Invoke(&self, error_code: windows::core::HRESULT, is_successful: BOOL) -> WinResult<()> {
        let result = if error_code.is_ok() && is_successful.as_bool() {
            Ok(())
        } else if error_code.is_err() {
            Err(format!("PrintToPdf 오류: HRESULT 0x{:08X}", error_code.0))
        } else {
            Err("PrintToPdf 실패 (is_successful = false)".to_string())
        };
        if let Some(tx) = self.tx.lock().unwrap().take() {
            let _ = tx.send(result);
        }
        Ok(())
    }
}

pub async fn create_pdf(win: &WebviewWindow, output_path: &str) -> Result<(), String> {
    let (tx, rx) = oneshot::channel::<Result<(), String>>();
    let tx_slot: TxSlot = Arc::new(Mutex::new(Some(tx)));
    let path_owned = output_path.to_string();

    win.with_webview({
        let tx_slot = tx_slot.clone();
        move |webview| invoke_print_to_pdf(webview, path_owned, tx_slot)
    })
    .map_err(|e| format!("with_webview 실패: {e}"))?;

    tokio::time::timeout(std::time::Duration::from_secs(30), rx)
        .await
        .map_err(|_| "PDF 생성 타임아웃 (30s)".to_string())?
        .map_err(|_| "PDF 채널 수신 오류".to_string())?
}

/// webview2-com을 통해 ICoreWebView2_7::PrintToPdf 호출
///
/// 모든 에러 경로(설정 실패 포함)가 tx_slot 채널을 통해 전달된다.
fn invoke_print_to_pdf(
    webview: tauri::webview::PlatformWebview,
    output_path: String,
    tx_slot: TxSlot,
) {
    let controller = webview.controller();

    let core: ICoreWebView2 = match unsafe { controller.CoreWebView2() } {
        Ok(c) => c,
        Err(e) => { send_err(&tx_slot, format!("CoreWebView2 접근 실패: {e}")); return; }
    };

    let core7: ICoreWebView2_7 = match core.cast::<ICoreWebView2_7>() {
        Ok(c) => c,
        Err(e) => { send_err(&tx_slot, format!("ICoreWebView2_7 캐스트 실패: {e}")); return; }
    };

    let path_hstr = HSTRING::from(output_path.as_str());

    // PrintToPdf 호출 에러를 위해 Arc를 하나 더 보관
    // (PdfHandler로 tx_slot을 move한 뒤에도 이 clone으로 에러 전송 가능)
    let fallback = tx_slot.clone();

    let handler: ICoreWebView2PrintToPdfCompletedHandler = PdfHandler { tx: tx_slot }.into();

    if let Err(e) = unsafe { core7.PrintToPdf(&path_hstr, None, &handler) } {
        // Invoke가 호출되지 않으므로 fallback으로 에러를 직접 전송
        send_err(&fallback, format!("PrintToPdf 호출 실패: {e}"));
    }
}
