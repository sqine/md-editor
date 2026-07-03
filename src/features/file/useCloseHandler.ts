import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useApp } from "../../shared/store/appStore";

/**
 * 앱 종료 요청을 가로채서:
 * - 미저장 탭 없음 → 바로 종료
 * - 미저장 탭 있음 → CloseDialog 표시
 */
export function useCloseHandler() {
  const { state, dispatch } = useApp();
  const anyDirtyRef = useRef(false);

  useEffect(() => {
    anyDirtyRef.current = state.tabs.some(t => t.isDirty);
  }, [state.tabs]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    getCurrentWindow().onCloseRequested(async (event) => {
      if (anyDirtyRef.current) {
        event.preventDefault();
        dispatch({ type: "SET_CLOSE_DIALOG", open: true });
      }
    }).then((fn) => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, [dispatch]);
}
