import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useApp } from "../../shared/store/appStore";

// CloseDialog에서 quit() 호출 시 onCloseRequested 재진입 방지용 플래그
let _skipNext = false;
export function allowNextClose() { _skipNext = true; }

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
      // CloseDialog의 quit()가 호출한 close() → 그냥 통과
      if (_skipNext) {
        _skipNext = false;
        return;
      }
      if (anyDirtyRef.current) {
        event.preventDefault();
        dispatch({ type: "SET_CLOSE_DIALOG", open: true });
      }
    }).then((fn) => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, [dispatch]);
}
