import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog, save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useApp, activeTab } from "../../shared/store/appStore";
import { useFile } from "../file/useFile";
import { buildPdfHtml } from "../export/exportHtml";

/**
 * Rust에서 emit한 메뉴 이벤트를 수신해 앱 액션으로 연결합니다.
 */
export function useMenu() {
  const { state, dispatch } = useApp();
  const { newFile, openFile, saveFile, saveFileAs } = useFile();

  // useEffect deps가 []이라 state가 stale해지므로 ref로 최신값 유지
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];

    const on = (event: string, handler: () => void) => {
      listen(event, handler).then((fn) => unlisteners.push(fn));
    };

    // 파일 메뉴
    on("new-file",    () => newFile());
    on("open-file",   () => openFile());
    on("open-folder", async () => {
      const folder = await openDialog({ directory: true }) as string | null;
      if (!folder) return;
      dispatch({ type: "SET_SIDEBAR_FOLDER", folder });
      if (!stateRef.current.sidebarOpen) dispatch({ type: "TOGGLE_SIDEBAR" });
    });
    on("save",    () => saveFile());
    on("save-as", () => saveFileAs());

    on("export-pdf", async () => {
      const tab = activeTab(stateRef.current);
      if (!tab) return;
      const path = await save({
        filters:     [{ name: "PDF", extensions: ["pdf"] }],
        defaultPath: tab.fileName.replace(/\.md$/, ".pdf"),
      }) as string | null;
      if (!path) return;
      try {
        await invoke("export_pdf", {
          html:       buildPdfHtml(tab.content, tab.fileName),
          outputPath: path,
        });
      } catch (e) {
        console.error("PDF 내보내기 실패:", e);
        alert(`PDF 저장 실패: ${e}`);
      }
    });

    // 보기 메뉴
    on("toggle-sidebar", () => dispatch({ type: "TOGGLE_SIDEBAR" }));
    on("focus-mode",     () => dispatch({ type: "TOGGLE_FOCUS" }));
    on("font-up",        () => dispatch({ type: "INC_FONT_SIZE" }));
    on("font-down",      () => dispatch({ type: "DEC_FONT_SIZE" }));
    on("font-reset",     () => dispatch({ type: "SET_FONT_SIZE", size: 15 }));
    on("settings",       () => dispatch({ type: "TOGGLE_SETTINGS" }));

    return () => unlisteners.forEach((fn) => fn());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
