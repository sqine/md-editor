import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useApp, activeTab } from "../../shared/store/appStore";
import { useToast } from "../../shared/ui/Toast";

function getFileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

export function useFile() {
  const { state, dispatch } = useApp();
  const { error } = useToast();

  const filePathRef = useRef<string | null>(null);
  useEffect(() => {
    filePathRef.current = activeTab(state).filePath;
  }, [state.tabs, state.activeTabId]);

  const newFile = useCallback(async () => {
    dispatch({ type: "NEW_TAB" });
  }, [dispatch]);

  const loadFile = useCallback(async (path: string) => {
    try {
      const tab = activeTab(state);
      const content = await invoke<string>("read_file_with_encoding", {
        path,
        encoding: tab.encoding,
      });
      dispatch({ type: "LOAD_FILE", path, name: getFileName(path), content });
      await invoke("add_recent_file", { path });
      const recents = await invoke<string[]>("get_recent_files");
      dispatch({ type: "SET_RECENT_FILES", files: recents });
      if (state.autoReload) {
        await invoke("watch_file", { path }).catch(() => {});
      }
    } catch (e) {
      const msg = String(e);
      // 파일이 존재하지 않으면 최근 목록에서 자동 제거 + alert
      if (msg.includes("os error 2") || msg.includes("No such file") || msg.includes("cannot find the file")) {
        error("파일을 찾을 수 없습니다", path);
        await invoke("remove_recent_file", { path }).catch(() => {});
        dispatch({ type: "REMOVE_RECENT_FILE", path });
      } else {
        error("파일을 열 수 없습니다", msg);
      }
    }
  }, [state, dispatch, error]);

  const openFile = useCallback(async (filePath?: string) => {
    const path = filePath ?? (await open({
      filters: [{ name: "Markdown", extensions: ["md", "txt", "markdown"] }],
      multiple: false,
    }) as string | null);
    if (path) await loadFile(path);
  }, [loadFile]);

  const saveFile = useCallback(async () => {
    const tab = activeTab(state);
    if (!tab.filePath) { await saveFileAs(); return; }
    try {
      await invoke("write_file_with_encoding", {
        path:     tab.filePath,
        content:  tab.content,
        encoding: tab.encoding,
      });
      dispatch({ type: "UPDATE_SAVED_AT", tabId: activeTab(state).id, ts: Date.now() });
      // 버전 스냅샷 + 초안 삭제 (실패 무시)
      invoke("save_version_snapshot", { filePath: tab.filePath }).catch(() => {});
      invoke("delete_draft", { tabId: tab.id }).catch(() => {});
    } catch (e) {
      error("저장 실패", String(e));
    }
  }, [state, dispatch, error]);

  const saveFileAs = useCallback(async () => {
    const tab = activeTab(state);
    const path = await save({
      filters:     [{ name: "Markdown", extensions: ["md"] }],
      defaultPath: tab.fileName,
    }) as string | null;
    if (!path) return;
    try {
      await invoke("write_file_with_encoding", {
        path,
        content:  tab.content,
        encoding: tab.encoding,
      });
      dispatch({ type: "UPDATE_SAVED_AT", tabId: activeTab(state).id, ts: Date.now() });
      dispatch({ type: "SET_FILE_PATH", path, name: getFileName(path) });
      await invoke("add_recent_file", { path });
      const recents = await invoke<string[]>("get_recent_files");
      dispatch({ type: "SET_RECENT_FILES", files: recents });
    } catch (e) {
      error("다른 이름으로 저장 실패", String(e));
    }
  }, [state, dispatch, error]);

  const saveTabByPath = useCallback(async (tabFilePath: string, content: string, encoding: string) => {
    await invoke("write_file_with_encoding", { path: tabFilePath, content, encoding });
  }, []);

  // ── 단축키 ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "n") { e.preventDefault(); newFile(); }
      if (mod && e.key === "s") { e.preventDefault(); e.shiftKey ? saveFileAs() : saveFile(); }
      if (mod && e.key === "o") { e.preventDefault(); openFile(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [newFile, saveFile, saveFileAs, openFile]);

  // ── 최근 파일 초기 로드 ─────────────────────────────────────────
  useEffect(() => {
    invoke<string[]>("get_recent_files")
      .then((files) => dispatch({ type: "SET_RECENT_FILES", files }))
      .catch(() => {});
  }, [dispatch]);

  // ── Finder에서 .md 파일 열기 (file association) ───────────────────
  useEffect(() => {
    const unlistenPromise = listen<string>("open-file", (event) => {
      loadFile(event.payload);
    });
    return () => { unlistenPromise.then((fn) => fn()); };
  }, [loadFile]);

  // ── 파일 드래그 앤 드롭 ────────────────────────────────────────────
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type === "drop") {
          for (const path of (event.payload as { paths: string[] }).paths) {
            if (/\.(md|txt|markdown)$/i.test(path)) {
              loadFile(path);
            }
          }
        }
      })
      .then((fn) => { unlisten = fn; })
      .catch(() => {});
    return () => { unlisten?.(); };
  }, [loadFile]);

  return { newFile, openFile, saveFile, saveFileAs, loadFile, saveTabByPath };
}

// ── 파일 변경 감지 ────────────────────────────────────────────────
export function useFileWatcher(onChanged: () => void) {
  useEffect(() => {
    const unlistenPromise = listen<string>("file-changed", onChanged);
    return () => { unlistenPromise.then((fn) => fn()); };
  }, [onChanged]);
}
