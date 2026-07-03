/// PDF 내보내기 모듈
///
/// macOS : WKWebView.createPDF() — objc2 + block2 (macos.rs)
/// Windows: ICoreWebView2_7.PrintToPdf() — webview2-com (windows.rs)
///
/// 흐름
/// 1. JS가 스타일 포함 HTML 문자열 + 저장 경로를 Tauri 커맨드로 전달
/// 2. Rust: 숨겨진 WebviewWindow 생성 → HTML 로드
/// 3. Rust: 플랫폼 PDF API 호출 → 파일 저장
/// 4. Rust: 임시 창 닫기 → JS에 완료 응답

#[cfg(target_os = "macos")]
pub mod macos;

#[cfg(target_os = "windows")]
pub mod windows;

use tauri::{AppHandle, WebviewWindowBuilder, WebviewUrl};

/// 공통 진입점.
/// HTML을 임시 파일로 저장 → file:// URL로 숨긴 WebviewWindow 생성
/// → 플랫폼 PDF API 호출 → 임시 파일·창 정리
pub async fn export_pdf_to_file(
    app: AppHandle,
    html: String,
    output_path: String,
) -> Result<(), String> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    // ── 임시 HTML 파일 저장 ──────────────────────────────────────────
    // WebviewUrl::App("about:blank") 은 Tauri에서 유효하지 않다.
    // file:// URL로 로드하면 eval 없이 HTML을 직접 렌더링할 수 있다.
    let temp_html = std::env::temp_dir().join(format!("md_pdf_{ts}.html"));
    std::fs::write(&temp_html, html.as_bytes())
        .map_err(|e| format!("임시 파일 저장 실패: {e}"))?;

    let file_url = url::Url::from_file_path(&temp_html)
        .map_err(|_| "파일 URL 생성 실패".to_string())?;

    // ── 숨겨진 창 생성 ───────────────────────────────────────────────
    let label = format!("pdf-export-{ts}");
    let win = WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::External(file_url),
    )
    .visible(false)
    .title("PDF Export")
    .inner_size(794.0, 1123.0)  // A4 @ 96 dpi (210mm × 297mm)
    .build()
    .map_err(|e| format!("창 생성 실패: {e}"))?;

    // 렌더링 완료 대기
    // buildPdfHtml 은 외부 CDN 의존성이 없으므로 600ms 로 충분
    tokio::time::sleep(std::time::Duration::from_millis(600)).await;

    // ── 플랫폼별 PDF 생성 ────────────────────────────────────────────
    let result: Result<(), String>;

    #[cfg(target_os = "macos")]
    { result = macos::create_pdf(&win, &output_path).await; }

    #[cfg(target_os = "windows")]
    { result = windows::create_pdf(&win, &output_path).await; }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    { result = Err("PDF 내보내기는 macOS/Windows에서만 지원됩니다.".to_string()); }

    // ── 정리 ─────────────────────────────────────────────────────────
    win.close().ok();
    std::fs::remove_file(&temp_html).ok();

    result
}
