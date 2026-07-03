/**
 * table-focus-plugin.ts
 *
 * Milkdown의 table-block 컴포넌트는 pointermove 이벤트를 기반으로
 * col/row 핸들 위치를 결정한다. 키보드 이동 / 타이핑 시 마우스가
 * 다른 셀 위에 있으면 핸들이 엉뚱한 셀을 가리키는 문제가 있다.
 *
 * 해결: ProseMirror selection이 바뀔 때마다 현재 포커스된 셀의
 * 중앙 좌표로 합성 PointerEvent(pointermove)를 발송한다.
 * 이 이벤트는 Milkdown의 기존 pointermove 핸들러를 그대로 트리거해
 * 핸들이 포커스 셀 기준으로 위치하게 된다.
 *
 * 마우스를 직접 움직이면 실제 pointermove가 우선하므로
 * "키보드 → 포커스 기준 / 마우스 → 호버 기준" 하이브리드 동작이 된다.
 */

import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

const tableFocusKey = new PluginKey("tableFocusBySelection");

export const tableFocusPlugin = $prose(() =>
  new Plugin({
    key: tableFocusKey,
    view(editorView) {
      // 마우스 버튼이 눌려 있는 동안 합성 이벤트를 억제한다.
      // 드래그 중 selection 변경마다 pointermove를 발사하면
      // Milkdown table-block 핸들러가 드래그를 방해하는 버그가 있다.
      let isMouseDown = false;

      const onMouseDown = () => { isMouseDown = true; };
      const onMouseUp   = () => {
        isMouseDown = false;
        // 클릭/드래그 완료 후 현재 포커스 셀로 핸들 위치를 갱신한다
        fireForCurrentCell(editorView);
      };

      editorView.dom.addEventListener("mousedown", onMouseDown);
      // mouseup은 에디터 밖에서 발생할 수 있으므로 document에 등록
      document.addEventListener("mouseup", onMouseUp);

      return {
        update(view, prevState) {
          // 마우스가 눌려 있으면 무시 (드래그 텍스트 선택 보호)
          if (isMouseDown) return;
          if (view.state.selection.eq(prevState.selection)) return;
          fireForCurrentCell(view);
        },
        destroy() {
          editorView.dom.removeEventListener("mousedown", onMouseDown);
          document.removeEventListener("mouseup", onMouseUp);
        },
      };
    },
  })
);

/** 현재 선택된 셀 중앙으로 합성 pointermove를 발송한다 */
function fireForCurrentCell(view: EditorView) {
  const $head = view.state.selection.$head;

  for (let d = $head.depth; d > 0; d--) {
    const typeName = $head.node(d).type.name;
    if (typeName !== "table_cell" && typeName !== "table_header") continue;

    const cellPos = $head.before(d);
    const cellDOM = view.nodeDOM(cellPos) as HTMLElement | null;
    if (!cellDOM) break;

    const tableWrapper =
      cellDOM.closest(".milkdown-table-block") as HTMLElement | null;
    if (!tableWrapper) break;

    const rect = cellDOM.getBoundingClientRect();
    tableWrapper.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        pointerType: "mouse",
      })
    );
    break;
  }
}
