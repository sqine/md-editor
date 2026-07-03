/**
 * 블록 선택 플러그인
 *
 * ── 동작 ─────────────────────────────────────────────────────────
 * 드래그로 여러 블록을 선택할 때 텍스트 단위가 아닌 블록 단위로 스냅.
 *  - 단일 블록 내부 선택 → 그대로 (텍스트 선택 정상 동작)
 *  - 블록 경계를 넘는 선택 → 블록 시작/끝으로 스냅 + 시각적 블록 하이라이트
 *
 * appendTransaction으로 스냅 → decorations로 블록 하이라이트 적용.
 * `attributes` prop으로 ProseMirror 루트에 block-select-active 클래스 추가
 * → CSS에서 텍스트 selection 색상을 투명으로 처리.
 */

import { Plugin, TextSelection, Selection } from "@milkdown/prose/state";
import { Decoration, DecorationSet } from "@milkdown/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { Node } from "@milkdown/prose/model";

/** pos를 포함하는 최상위 블록의 범위 반환 */
function topLevelBlockAround(
  doc: Node,
  pos: number,
): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null;
  doc.forEach((node, offset) => {
    if (offset <= pos && offset + node.nodeSize > pos) {
      found = { from: offset, to: offset + node.nodeSize };
    }
  });
  return found;
}

export const blockSelectionPlugin = $prose(
  () =>
    new Plugin({
      props: {
        // 블록 사이 빈 공간 드래그 → 텍스트 선택 방지
        // e.target === view.dom 이면 ProseMirror 패딩/갭 클릭이므로 preventDefault.
        // 커서 배치(클릭)는 posAtCoords로 수동 처리해 UX 유지.
        handleDOMEvents: {
          mousedown: (view, event) => {
            if (event.target !== view.dom) return false;
            event.preventDefault();
            // 빈 공간 클릭 시에도 가장 가까운 위치에 커서 배치
            const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (coords) {
              try {
                const $pos = view.state.doc.resolve(coords.pos);
                view.dispatch(view.state.tr.setSelection(Selection.near($pos)));
              } catch { /* invalid pos */ }
            }
            view.focus();
            return true;
          },
        },

        // ProseMirror 루트 엘리먼트에 block-select-active 클래스 추가
        // → CSS: .ProseMirror.block-select-active *::selection { background: transparent }
        attributes(state) {
          const sel = state.selection;
          if (sel instanceof TextSelection && !sel.empty) {
            const fb = topLevelBlockAround(state.doc, sel.from);
            const tb = topLevelBlockAround(state.doc, sel.to);
            if (fb && tb && fb.from !== tb.from) {
              return { class: "block-select-active" };
            }
          }
          return { class: "" };
        },

        // 선택된 블록에 block-selected 클래스 데코레이션
        decorations(state) {
          const sel = state.selection;
          if (!(sel instanceof TextSelection) || sel.empty) return DecorationSet.empty;

          const fb = topLevelBlockAround(state.doc, sel.from);
          const tb = topLevelBlockAround(state.doc, sel.to);
          // 단일 블록 내부 선택 → 데코레이션 없음
          if (!fb || !tb || fb.from === tb.from) return DecorationSet.empty;

          const decos: Decoration[] = [];
          state.doc.forEach((node, offset) => {
            const from = offset;
            const to   = offset + node.nodeSize;
            // 선택 범위가 블록 전체를 커버하면 하이라이트
            if (sel.from <= from + 1 && sel.to >= to - 1) {
              decos.push(Decoration.node(from, to, { class: "block-selected" }));
            }
          });

          return decos.length
            ? DecorationSet.create(state.doc, decos)
            : DecorationSet.empty;
        },
      },

      // 블록 경계를 넘는 TextSelection → 블록 단위로 스냅
      appendTransaction(transactions, _oldState, newState) {
        // 선택이 변경된 트랜잭션이 없으면 무시
        if (!transactions.some((tr) => tr.selectionSet)) return null;

        const sel = newState.selection;
        if (!(sel instanceof TextSelection) || sel.empty) return null;

        const doc = newState.doc;
        const fb  = topLevelBlockAround(doc, sel.from);
        const tb  = topLevelBlockAround(doc, sel.to);

        if (!fb || !tb) return null;
        if (fb.from === tb.from) return null; // 단일 블록 내부 → 스냅 안 함

        // 블록 경계로 스냅
        const snapFrom = fb.from + 1;  // 블록 내용 시작
        const snapTo   = tb.to - 1;   // 블록 내용 끝

        // 이미 스냅됐으면 루프 방지용 early return
        if (snapFrom === sel.from && snapTo === sel.to) return null;

        return newState.tr.setSelection(
          TextSelection.create(doc, snapFrom, snapTo),
        );
      },
    }),
);
