import { useReducer, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { callCommand } from "@milkdown/utils";
import { redoCommand } from "@milkdown/plugin-history";
import { AppContext, appReducer, defaultState, activeTab, saveSettings } from "../shared/store/appStore";
import { crepeInstance } from "../widgets/editor/Editor";
import { getFontStack } from "../shared/lib/fonts";
import { useCloseHandler } from "../features/file/useCloseHandler";
import { useAutoDraft } from "../features/file/useAutoDraft";
import { useMenu } from "../features/menu/useMenu";
import { ToastProvider } from "../shared/ui/Toast";
import Toolbar      from "../widgets/toolbar/Toolbar";
import TabBar       from "../widgets/tab-bar/TabBar";
import Sidebar      from "../widgets/sidebar/Sidebar";
import Editor       from "../widgets/editor/Editor";
import StatusBar    from "../widgets/status-bar/StatusBar";
import Settings     from "../widgets/settings/Settings";
import CloseDialog  from "../widgets/close-dialog/CloseDialog";
import "./styles/global.css";

function AppInner() {
  useCloseHandler();
  useMenu();
  useAutoDraft(); // 60초마다 더티 탭 자동 초안 저장
  return null;
}

export default function App() {
  const [state, dispatch] = useReducer(appReducer, defaultState);

  // 설정 영속성: 관련 값이 바뀔 때마다 localStorage에 저장
  useEffect(() => {
    saveSettings(state);
  }, [
    state.theme, state.fontSize, state.fontFamily,
    state.defaultEncoding, state.autoReload, state.saveOnFocusLoss,
    state.recentFiles, state.sidebarOpen, state.sidebarFolder,
  ]);

  // 테마
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", state.theme);
  }, [state.theme]);

  // 폰트 크기
  useEffect(() => {
    document.documentElement.style.setProperty("--font-size-base", `${state.fontSize}px`);
  }, [state.fontSize]);

  // 폰트 패밀리
  useEffect(() => {
    document.documentElement.style.setProperty("--font-editor", getFontStack(state.fontFamily));
  }, [state.fontFamily]);

  // 전역 단축키
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "=" || e.key === "+")) { e.preventDefault(); dispatch({ type: "INC_FONT_SIZE" }); }
      if (mod && e.key === "-")  { e.preventDefault(); dispatch({ type: "DEC_FONT_SIZE" }); }
      if (mod && e.key === "0")  { e.preventDefault(); dispatch({ type: "SET_FONT_SIZE", size: 15 }); }
      if (mod && e.key === "\\") { e.preventDefault(); dispatch({ type: "TOGGLE_SIDEBAR" }); }
      if (mod && e.key === ",")  { e.preventDefault(); dispatch({ type: "TOGGLE_SETTINGS" }); }
      if (e.key === "F11" || (mod && e.shiftKey && e.key === "f")) {
        e.preventDefault();
        dispatch({ type: "TOGGLE_FOCUS" });
      }
      // Ctrl+Y → redo (Windows 스타일, macOS는 Cmd+Shift+Z로 ProseMirror 자체 처리)
      if (e.ctrlKey && !e.metaKey && e.key === "y") {
        e.preventDefault();
        crepeInstance?.editor.action(callCommand(redoCommand.key));
      }
      // Cmd+Z → undo 명시 (ProseMirror도 처리하지만 확실하게)
      if (mod && !e.shiftKey && e.key === "z") {
        // ProseMirror가 먼저 처리하므로 여기선 preventDefault만 안 함
      }
      // Cmd+. → 글쓰기 모드 토글 (Cmd+Shift+Z는 redo에 양보)
      if (mod && !e.shiftKey && e.key === ".") {
        e.preventDefault();
        dispatch({ type: "TOGGLE_ZEN" });
      }
      if (e.key === "Escape") {
        if (state.zenMode) {
          // 1단계: zen 해제 (툴바/탭 복원). 전체화면은 유지.
          dispatch({ type: "SET_ZEN", value: false });
        } else if (state.osFullscreen) {
          // 2단계: 전체화면 종료
          await getCurrentWindow().setFullscreen(false).catch(() => {});
          dispatch({ type: "SET_OS_FULLSCREEN", value: false });
        } else if (state.settingsOpen) {
          dispatch({ type: "TOGGLE_SETTINGS" });
        } else if (state.focusMode) {
          dispatch({ type: "TOGGLE_FOCUS" });
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [state.fontSize, state.focusMode, state.settingsOpen, state.osFullscreen, state.zenMode, dispatch]);

  // OS 전체화면 상태 동기화
  // macOS에서 ESC로 네이티브 전체화면을 종료할 때 OS가 JS keydown보다 먼저 처리하면
  // 스토어의 osFullscreen이 true인 채로 남는다. onResized로 실제 상태를 감지해 동기화.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onResized(async () => {
        const isFs = await getCurrentWindow().isFullscreen();
        dispatch({ type: "SET_OS_FULLSCREEN", value: isFs });
        if (!isFs) dispatch({ type: "SET_ZEN", value: false });
      })
      .then((fn) => { unlisten = fn; })
      .catch(() => {});
    return () => { unlisten?.(); };
  }, [dispatch]);

  // zen 모드 복원 버튼 핸들러 — zen만 해제, 전체화면은 유지
  const handleExitZen = () => {
    dispatch({ type: "SET_ZEN", value: false });
  };

  const tab = activeTab(state);

  const rootClass = [
    state.focusMode    ? "focus-mode"  : "",
    state.zenMode      ? "zen-mode"    : "",
    state.osFullscreen ? "os-fullscreen" : "",
  ].filter(Boolean).join(" ");

  return (
    <ToastProvider>
      <AppContext.Provider value={{ state, dispatch }}>
        <AppInner />
        <div id="app-root" className={rootClass}>
          <Toolbar />
          <div id="main-area">
            <Sidebar />
            <div id="editor-area">
              <TabBar />
              <Editor
                key={state.activeTabId}
                initialContent={tab.content}
              />
            </div>
          </div>
          <StatusBar />
          <Settings />
          <CloseDialog />

          {/* 글쓰기 모드 복원 버튼 — 아이콘만 반투명, 호버 시 펼침 */}
          {state.zenMode && (
            <button
              id="zen-restore-btn"
              onClick={handleExitZen}
              title="글쓰기 모드 종료 (Esc)"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>toolbar</span>
              <span className="zen-restore-label">도구 표시</span>
            </button>
          )}
        </div>
      </AppContext.Provider>
    </ToastProvider>
  );
}
