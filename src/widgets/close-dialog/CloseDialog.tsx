import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { useApp, activeTab } from "../../shared/store/appStore";
import { useFile } from "../../features/file/useFile";
import { useToast } from "../../shared/ui/Toast";
import "./CloseDialog.css";

export default function CloseDialog() {
  const { state, dispatch } = useApp();
  const { saveFile, saveTabByPath } = useFile();
  const { error } = useToast();
  const [tempPath, setTempPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!state.closeDialogOpen) return null;

  const dirtyTabs = state.tabs.filter(t => t.isDirty);
  const tab       = activeTab(state);
  const multiDirty = dirtyTabs.length > 1;

  const close = () => dispatch({ type: "SET_CLOSE_DIALOG", open: false });
  const quit  = () => getCurrentWindow().close();

  /** 단일 탭: 저장 후 종료 */
  const handleSaveAndQuit = async () => {
    setBusy(true);
    try {
      await saveFile();
      quit();
    } catch {
      setBusy(false);
    }
  };

  /** 다중 탭: 경로 있는 탭 모두 저장 후 종료 */
  const handleSaveAllAndQuit = async () => {
    setBusy(true);
    try {
      for (const t of dirtyTabs) {
        if (t.filePath) {
          await saveTabByPath(t.filePath, t.content, t.encoding);
        }
      }
      quit();
    } catch (e) {
      error("저장 실패", String(e));
      setBusy(false);
    }
  };

  /** 임시 파일로 저장 후 종료 (현재 탭) */
  const handleTempSaveAndQuit = async () => {
    setBusy(true);
    try {
      const path = await invoke<string>("save_temp_file", {
        content:  tab.content,
        filename: tab.fileName,
      });
      setTempPath(path);
    } catch (e) {
      error("임시 저장 실패", String(e));
      setBusy(false);
    }
  };

  // 임시 저장 완료 화면
  if (tempPath) {
    return (
      <div className="cd-overlay">
        <div className="cd-modal">
          <div className="cd-icon">💾</div>
          <h2 className="cd-title">임시 파일로 저장됨</h2>
          <p className="cd-desc">나중에 아래 경로에서 복구할 수 있습니다.</p>
          <div className="cd-path">{tempPath}</div>
          <div className="cd-actions">
            <button className="cd-btn cd-btn-primary" onClick={quit}>종료</button>
            <button className="cd-btn cd-btn-ghost"   onClick={() => { setTempPath(null); close(); }}>
              돌아가기
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cd-overlay">
      <div className="cd-modal">
        <div className="cd-icon">⚠️</div>
        <h2 className="cd-title">저장하지 않은 변경 사항</h2>

        {multiDirty ? (
          <p className="cd-desc">
            <strong>{dirtyTabs.length}개</strong>의 파일에 저장하지 않은 내용이 있습니다.
          </p>
        ) : (
          <p className="cd-desc">
            <strong>{tab.fileName}</strong>에 저장하지 않은 내용이 있습니다.
          </p>
        )}

        {/* 다중 탭일 때 파일 목록 */}
        {multiDirty && (
          <ul className="cd-dirty-list">
            {dirtyTabs.map(t => (
              <li key={t.id}>{t.fileName}{!t.filePath ? " (저장 경로 없음)" : ""}</li>
            ))}
          </ul>
        )}

        <div className="cd-actions cd-actions-col">
          {multiDirty ? (
            <button
              className="cd-btn cd-btn-primary"
              onClick={handleSaveAllAndQuit}
              disabled={busy}
            >
              모두 저장하고 종료
            </button>
          ) : (
            <button
              className="cd-btn cd-btn-primary"
              onClick={handleSaveAndQuit}
              disabled={busy}
            >
              저장하고 종료
            </button>
          )}
          {!multiDirty && (
            <button
              className="cd-btn cd-btn-secondary"
              onClick={handleTempSaveAndQuit}
              disabled={busy}
            >
              임시 파일로 저장 후 종료
              <span className="cd-sub">앱 데이터 폴더에 백업 후 종료</span>
            </button>
          )}
          <button
            className="cd-btn cd-btn-danger"
            onClick={quit}
            disabled={busy}
          >
            저장하지 않고 종료
          </button>
          <button
            className="cd-btn cd-btn-ghost"
            onClick={close}
            disabled={busy}
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
