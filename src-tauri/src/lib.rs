mod pdf;

use std::sync::{Arc, Mutex};
use notify::{RecommendedWatcher, RecursiveMode, Watcher, Event};
use tauri::{AppHandle, Emitter, Manager};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri_plugin_window_state::StateFlags;
use tauri_plugin_deep_link::DeepLinkExt;
use encoding_rs::Encoding;
use std::path::PathBuf;

// ── 파일 읽기 (인코딩 지원) ──────────────────────────────────────
#[tauri::command]
fn read_file_with_encoding(path: String, encoding: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let enc = Encoding::for_label(encoding.as_bytes())
        .unwrap_or(encoding_rs::UTF_8);
    let (cow, _, _) = enc.decode(&bytes);
    Ok(cow.into_owned())
}

// ── 바이너리 파일 쓰기 (이미지 크롭/리사이즈 결과 저장) ──────────
#[tauri::command]
fn write_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, &data).map_err(|e| e.to_string())
}

// ── 파일 쓰기 (인코딩 지원) ──────────────────────────────────────
#[tauri::command]
fn write_file_with_encoding(path: String, content: String, encoding: String) -> Result<(), String> {
    let enc = Encoding::for_label(encoding.as_bytes())
        .unwrap_or(encoding_rs::UTF_8);
    let (bytes, _, _) = enc.encode(&content);
    std::fs::write(&path, bytes.as_ref()).map_err(|e| e.to_string())
}

// ── 파일 감시 ─────────────────────────────────────────────────────
struct WatcherState(Arc<Mutex<Option<RecommendedWatcher>>>);

#[tauri::command]
fn watch_file(path: String, app: AppHandle) -> Result<(), String> {
    let app_state = app.state::<WatcherState>();
    let mut guard = app_state.0.lock().unwrap();

    // 기존 watcher 교체
    *guard = None;

    let app_clone = app.clone();
    let watch_path = PathBuf::from(&path);

    let mut watcher = notify::recommended_watcher(move |res: Result<Event, _>| {
        if let Ok(event) = res {
            use notify::EventKind::*;
            match event.kind {
                Modify(_) | Create(_) => {
                    let _ = app_clone.emit("file-changed", &path);
                }
                _ => {}
            }
        }
    }).map_err(|e| e.to_string())?;

    watcher.watch(&watch_path, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    *guard = Some(watcher);
    Ok(())
}

#[tauri::command]
fn unwatch_file(app: AppHandle) {
    let app_state = app.state::<WatcherState>();
    let mut guard = app_state.0.lock().unwrap();
    *guard = None;
}

// ── 최근 파일 목록 ────────────────────────────────────────────────
#[tauri::command]
fn get_recent_files(app: AppHandle) -> Vec<String> {
    let path = recent_files_path(&app);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
fn add_recent_file(path: String, app: AppHandle) {
    let file_path = recent_files_path(&app);
    let mut list: Vec<String> = std::fs::read_to_string(&file_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    list.retain(|p| p != &path);
    list.insert(0, path);
    list.truncate(20);

    let _ = std::fs::write(&file_path, serde_json::to_string(&list).unwrap());
}

// ── 최근 파일 제거 ────────────────────────────────────────────────
#[tauri::command]
fn remove_recent_file(path: String, app: AppHandle) {
    let file_path = recent_files_path(&app);
    let mut list: Vec<String> = std::fs::read_to_string(&file_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    list.retain(|p| p != &path);
    let _ = std::fs::write(&file_path, serde_json::to_string(&list).unwrap());
}

// ── 임시 파일 저장 ────────────────────────────────────────────────
#[tauri::command]
fn save_temp_file(content: String, filename: String, app: AppHandle) -> Result<String, String> {
    let temp_dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("temp");
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    let stem = std::path::Path::new(&filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("untitled");

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let temp_path = temp_dir.join(format!("{}_{}.md", stem, ts));
    std::fs::write(&temp_path, content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(temp_path.to_string_lossy().into_owned())
}

fn recent_files_path(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("recent_files.json")
}

fn drafts_dir(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("drafts")
}

// ── 자동 초안 저장 ────────────────────────────────────────────────
#[tauri::command]
fn save_draft(tab_id: String, file_name: String, content: String, app: AppHandle) -> Result<(), String> {
    let dir = drafts_dir(&app);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // 내용: JSON {fileName, savedAt, content}
    let meta = serde_json::json!({
        "tabId":    tab_id,
        "fileName": file_name,
        "savedAt":  std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64,
        "content":  content,
    });
    std::fs::write(dir.join(format!("{}.json", tab_id)),
        serde_json::to_string(&meta).unwrap())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_draft(tab_id: String, app: AppHandle) {
    let path = drafts_dir(&app).join(format!("{}.json", tab_id));
    let _ = std::fs::remove_file(path);
}

#[tauri::command]
fn list_drafts(app: AppHandle) -> Vec<serde_json::Value> {
    let dir = drafts_dir(&app);
    let Ok(entries) = std::fs::read_dir(&dir) else { return vec![]; };
    entries.filter_map(|e| {
        let path = e.ok()?.path();
        let text = std::fs::read_to_string(&path).ok()?;
        let val: serde_json::Value = serde_json::from_str(&text).ok()?;
        Some(val)
    }).collect()
}

#[tauri::command]
fn read_draft(tab_id: String, app: AppHandle) -> Result<String, String> {
    let path = drafts_dir(&app).join(format!("{}.json", tab_id));
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let val: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    Ok(val["content"].as_str().unwrap_or("").to_string())
}

// ── 버전 스냅샷 (Cmd+S마다 선택적 백업) ──────────────────────────
#[tauri::command]
fn save_version_snapshot(file_path: String) -> Result<(), String> {
    let src = std::path::Path::new(&file_path);
    if !src.exists() { return Ok(()); }

    let parent = src.parent().unwrap_or(std::path::Path::new("."));
    let stem   = src.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext    = src.extension().and_then(|s| s.to_str()).unwrap_or("md");

    let ver_dir = parent.join(format!(".{}_versions", stem));
    std::fs::create_dir_all(&ver_dir).map_err(|e| e.to_string())?;

    // 타임스탬프 파일명
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let dt = chrono_ts(now);
    let dest = ver_dir.join(format!("{}_{}.{}", stem, dt, ext));

    std::fs::copy(src, dest).map_err(|e| e.to_string())?;

    // 최대 30개 유지
    let mut versions: Vec<_> = std::fs::read_dir(&ver_dir)
        .map(|rd| rd.filter_map(|e| e.ok()).collect())
        .unwrap_or_default();
    if versions.len() > 30 {
        versions.sort_by_key(|e| e.file_name());
        for old in &versions[..versions.len() - 30] {
            let _ = std::fs::remove_file(old.path());
        }
    }
    Ok(())
}

fn chrono_ts(secs: u64) -> String {
    // 간단한 UTC 타임스탬프 포매터 (chrono 의존성 없이)
    let s = secs % 60;
    let m = (secs / 60) % 60;
    let h = (secs / 3600) % 24;
    let days = secs / 86400;
    // 2000-01-01 기준 (unix epoch 2000-01-01 = 946684800)
    let epoch_2000: u64 = 946684800;
    let total_days = if secs >= epoch_2000 { (secs - epoch_2000) / 86400 } else { days };
    // 간략히 YYYYMMDD_HHMMSS 대신 unix timestamp 사용
    let _ = total_days;
    format!("{:04}-{:02}-{:02}_{:02}-{:02}-{:02}",
        1970 + (secs / 31536000),
        ((secs % 31536000) / 2628000) + 1,
        ((secs % 2628000) / 86400) + 1,
        h, m, s)
}

// ── PDF 내보내기 커맨드 ────────────────────────────────────────────
/// html: 완전한 HTML 문자열 (스타일 포함)
/// output_path: 저장할 .pdf 파일 전체 경로
#[tauri::command]
async fn export_pdf(
    app: AppHandle,
    html: String,
    output_path: String,
) -> Result<(), String> {
    pdf::export_pdf_to_file(app, html, output_path).await
}

// ── 네이티브 메뉴 ────────────────────────────────────────────────
fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    // ── MDEditor 앱 메뉴 (macOS 첫 번째 메뉴 = 앱 이름 메뉴) ─────
    let about_item    = PredefinedMenuItem::about(app, Some("MDEditor 정보..."), None)?;
    let sep_a1        = PredefinedMenuItem::separator(app)?;
    let settings_item = MenuItem::with_id(app, "settings", "설정...", true, Some("CmdOrCtrl+,"))?;
    let sep_a2        = PredefinedMenuItem::separator(app)?;
    let quit_item     = PredefinedMenuItem::quit(app, Some("MDEditor 종료"))?;

    let app_menu = Submenu::with_id_and_items(app, "mde-app", "MDEditor", true, &[
        &about_item, &sep_a1, &settings_item, &sep_a2, &quit_item,
    ])?;

    // ── 파일 메뉴 ─────────────────────────────────────────────────
    let new_file    = MenuItem::with_id(app, "new-file",    "새 파일",              true, Some("CmdOrCtrl+N"))?;
    let open_file   = MenuItem::with_id(app, "open-file",   "파일 열기...",          true, Some("CmdOrCtrl+O"))?;
    let open_folder = MenuItem::with_id(app, "open-folder", "폴더 열기...",          true, None::<&str>)?;
    let sep1        = PredefinedMenuItem::separator(app)?;
    let save        = MenuItem::with_id(app, "save",         "저장",                 true, Some("CmdOrCtrl+S"))?;
    let save_as     = MenuItem::with_id(app, "save-as",      "다른 이름으로 저장...", true, Some("CmdOrCtrl+Shift+S"))?;
    let sep2       = PredefinedMenuItem::separator(app)?;
    let export_pdf = MenuItem::with_id(app, "export-pdf", "PDF로 내보내기", true, None::<&str>)?;

    let file_menu = Submenu::with_id_and_items(app, "file", "파일", true, &[
        &new_file, &open_file, &open_folder,
        &sep1, &save, &save_as,
        &sep2, &export_pdf,
    ])?;

    // ── 편집 메뉴 ─────────────────────────────────────────────────
    let undo   = PredefinedMenuItem::undo(app, Some("실행 취소"))?;
    let redo   = PredefinedMenuItem::redo(app, Some("다시 실행"))?;
    let sep4   = PredefinedMenuItem::separator(app)?;
    let cut    = PredefinedMenuItem::cut(app, Some("잘라내기"))?;
    let copy   = PredefinedMenuItem::copy(app, Some("복사"))?;
    let paste  = PredefinedMenuItem::paste(app, Some("붙여넣기"))?;
    let selall = PredefinedMenuItem::select_all(app, Some("전체 선택"))?;

    let edit_menu = Submenu::with_id_and_items(app, "edit", "편집", true, &[
        &undo, &redo, &sep4, &cut, &copy, &paste, &selall,
    ])?;

    // ── 보기 메뉴 ─────────────────────────────────────────────────
    let sidebar    = MenuItem::with_id(app, "toggle-sidebar", "사이드바",         true, Some("CmdOrCtrl+\\"))?;
    let focus      = MenuItem::with_id(app, "focus-mode",     "집중 모드",        true, Some("F11"))?;
    let sep5       = PredefinedMenuItem::separator(app)?;
    let font_up    = MenuItem::with_id(app, "font-up",        "글꼴 크게",        true, Some("CmdOrCtrl+="))?;
    let font_down  = MenuItem::with_id(app, "font-down",      "글꼴 작게",        true, Some("CmdOrCtrl+-"))?;
    let font_reset = MenuItem::with_id(app, "font-reset",     "글꼴 크기 초기화", true, Some("CmdOrCtrl+0"))?;

    let view_menu = Submenu::with_id_and_items(app, "view", "보기", true, &[
        &sidebar, &focus, &sep5,
        &font_up, &font_down, &font_reset,
    ])?;

    Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &view_menu])
}

// ── 앱 진입점 ─────────────────────────────────────────────────────
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .menu(|app| build_menu(app))
        .on_menu_event(|app, event| {
            let _ = app.emit(event.id().as_ref(), ());
        })
        .manage(WatcherState(Arc::new(Mutex::new(None))))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default()
            .with_state_flags(StateFlags::POSITION | StateFlags::SIZE | StateFlags::MAXIMIZED)
            .build())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            let handle = app.handle().clone();
            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    if let Ok(path) = url.to_file_path() {
                        if let Some(p) = path.to_str() {
                            let _ = handle.emit("open-file", p.to_string());
                        }
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_file_with_encoding,
            write_file_with_encoding,
            write_binary_file,
            watch_file,
            unwatch_file,
            get_recent_files,
            add_recent_file,
            remove_recent_file,
            save_temp_file,
            save_draft,
            delete_draft,
            list_drafts,
            read_draft,
            save_version_snapshot,
            export_pdf,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
