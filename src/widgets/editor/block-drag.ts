/**
 * block-drag.ts  (v6 — 핸들 전용)
 *
 * 블록 드래그 앤 드롭 + 핸들 클릭 선택.
 * FlatBlock 모델 및 드롭 타겟 계산 → block-drag-model.ts
 * 전체 블록 핸들 DOM 관리          → block-list-handle.ts
 *
 * ── 선택 방식 ─────────────────────────────────────────────────────
 *   핸들 클릭      → 블록 선택/토글 (연속 블록만 추가 가능)
 *                    ‣ 선택 없거나 비인접 → 교체 (해당 블록만 선택)
 *                    ‣ 인접               → 기존 선택에 추가
 *                    ‣ 이미 선택된 블록  → 전체 선택 해제
 *   PM 콘텐츠 클릭 → 블록 선택 전체 해제
 *   Escape         → 블록 선택 전체 해제
 *
 * ── 드래그 동작 ──────────────────────────────────────────────────
 *   핸들 드래그 (선택된 블록)   → 선택된 블록 전체 이동
 *   핸들 드래그 (미선택 블록)   → 그 블록만 이동
 *
 * ── 트랜잭션 케이스 ───────────────────────────────────────────────
 *   A  멀티블록(level-0), inList:false → Fragment.from insert
 *   A' 멀티블록(level-0), inList:true  → 각 노드를 list_item 래핑 후 insert
 *   B  단일 level-0, inList:false      → 노드 그대로 이동
 *   B' 단일 level-0, inList:true       → list_item 래핑 후 이동
 *   C  단일 level-1, inList:true       → listItem 노드 이동
 *   D  단일 level-1, inList:false      → node.content 로 top-level lift
 */

import type { EditorView } from "@milkdown/prose/view";
import { Fragment }        from "@milkdown/prose/model";
import type { Node as PMNode } from "@milkdown/prose/model";
import { NodeSelection }   from "@milkdown/prose/state";
import {
  type FlatBlock,
  type DropTarget,
  getFlatBlocks,
  findFlatBlockAtY,
  getDropTarget,
  wrapInListItem,
} from "./block-drag-model";
import { setupBlockHandles } from "./block-list-handle";

// ── NodeSelection 유틸 ────────────────────────────────────────────

function selectNodeAt(view: EditorView, pos: number) {
  try {
    view.dispatch(
      view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)),
    );
  } catch { /* pos가 유효하지 않을 때 무시 */ }
}

// ── 메인 ──────────────────────────────────────────────────────────

export function setupBlockDrag(
  containerEl: HTMLElement,
  getView: () => EditorView | null,
): () => void {

  // ════════════════════════════════════════════════════════════════
  // 드래그 상태
  // ════════════════════════════════════════════════════════════════
  let pending  = false;
  let dragging = false;
  let startX   = 0;
  let startY   = 0;
  let grabOffsetY      = 0;
  let sourceInitialTop = 0;

  let sourceFlatBlock:    FlatBlock | null = null;
  let selectedFlatBlocks: FlatBlock[]      = [];
  let dropTarget: DropTarget | null        = null;

  let ghost:     HTMLElement | null = null;
  let indicator: HTMLElement | null = null;
  let sourceEl:  HTMLElement | null = null;
  let portalEl:  HTMLElement | null = null;

  // ════════════════════════════════════════════════════════════════
  // 커스텀 블록 선택 상태
  // ════════════════════════════════════════════════════════════════
  const selectedPositions = new Set<number>();

  const updateSelectionHighlight = () => {
    const view = getView();
    containerEl.querySelectorAll(".milkdown-block-selected")
      .forEach((el) => el.classList.remove("milkdown-block-selected"));
    if (!view || !selectedPositions.size) return;
    for (const pos of selectedPositions) {
      const el = view.nodeDOM(pos) as HTMLElement | null;
      if (el) el.classList.add("milkdown-block-selected");
    }
  };

  const clearBlockSelection = () => {
    selectedPositions.clear();
    updateSelectionHighlight();
  };

  /** selectedPositions에 해당하는 블록들의 인덱스 범위. 선택 없으면 null. */
  const getSelectionIdxRange = (
    allBlocks: FlatBlock[],
  ): { start: number; end: number } | null => {
    if (!selectedPositions.size) return null;
    let start = Infinity, end = -Infinity;
    for (let i = 0; i < allBlocks.length; i++) {
      if (selectedPositions.has(allBlocks[i].pos)) {
        start = Math.min(start, i);
        end   = Math.max(end, i);
      }
    }
    return start === Infinity ? null : { start, end };
  };

  /**
   * 핸들 클릭 시 블록 선택 토글 (연속 블록만 추가 가능):
   *   이미 선택 → 전체 해제
   *   인접 블록  → 기존 선택에 추가
   *   비인접     → 해당 블록만으로 교체
   */
  const applyBlockClick = (fb: FlatBlock) => {
    const view = getView();
    if (!view) return;

    if (selectedPositions.has(fb.pos)) {
      clearBlockSelection();
    } else {
      const allBlocks = getFlatBlocks(view);
      const idx       = allBlocks.findIndex((b) => b.pos === fb.pos);
      if (idx < 0) return;

      const range = getSelectionIdxRange(allBlocks);
      if (!range) {
        selectedPositions.add(fb.pos);
      } else if (idx === range.start - 1 || idx === range.end + 1) {
        // 인접 → 추가 (연속 선택 유지)
        selectedPositions.add(fb.pos);
      } else {
        // 비인접 → 교체
        selectedPositions.clear();
        selectedPositions.add(fb.pos);
      }
      updateSelectionHighlight();
    }
    view.focus();
  };

  // ── 드래그 정리 ─────────────────────────────────────────────────
  function cleanup() {
    pending  = false;
    dragging = false;
    ghost?.remove();     ghost     = null;
    indicator?.remove(); indicator = null;
    portalEl?.remove();  portalEl  = null;
    if (sourceEl) { sourceEl.style.opacity = ""; sourceEl = null; }
    sourceFlatBlock    = null;
    selectedFlatBlocks = [];
    dropTarget         = null;
    document.body.style.cursor = "";
  }

  // ════════════════════════════════════════════════════════════════
  // 이벤트 핸들러 (Pointer — 핸들 전용)
  // ════════════════════════════════════════════════════════════════

  // HTML drag API 완전 차단 (native drag와 pointer 이벤트 충돌 방지)
  const onDragStart = (e: DragEvent) => {
    if (
      containerEl.contains(e.target as Element) ||
      (e.target as Element).closest?.(".md-drag-handle")
    ) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const onPointerDown = (e: PointerEvent) => {
    if (pending || dragging) return;

    const isHandle = !!(e.target as Element).closest?.(".md-drag-handle");

    if (!isHandle) {
      // 콘텐츠 영역 / 에디터 외부 클릭 → 블록 선택 해제
      if (selectedPositions.size > 0 && containerEl.contains(e.target as Node)) {
        clearBlockSelection();
      }
      return;
    }

    // 핸들 클릭 / 드래그 시작
    e.preventDefault();
    pending = true;
    startX  = e.clientX;
    startY  = e.clientY;
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!pending && !dragging) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    // ── 드래그 진입 (3px threshold) ───────────────────────────
    if (!dragging) {
      if (Math.hypot(dx, dy) < 3) return;

      const view = getView();
      if (!view) { cleanup(); return; }

      const fb = findFlatBlockAtY(view, startY);
      if (!fb) { cleanup(); return; }
      sourceFlatBlock = fb;

      const allBlocks = getFlatBlocks(view);

      // 선택된 블록 핸들 드래그 → 선택 전체 이동 (single/multi 모두)
      // size > 0: 1개 선택이어도 해당 핸들 드래그 시 선택 유지
      // Y좌표 범위 fallback으로 핸들 위치와 FlatBlock 경계가 살짝 어긋날 때도 대응
      const isInSelection =
        selectedPositions.size > 0 &&
        (selectedPositions.has(fb.pos) ||
          allBlocks.some(
            (b) => selectedPositions.has(b.pos) && startY >= b.top - 12 && startY <= b.bottom + 12,
          ));

      if (isInSelection) {
        selectedFlatBlocks = allBlocks.filter((b) => selectedPositions.has(b.pos));
      } else {
        if (!selectedPositions.has(fb.pos)) clearBlockSelection();
        selectedFlatBlocks = [fb];
        selectNodeAt(view, fb.pos);
      }

      // 드래그 시작 시 선택 하이라이트 제거
      containerEl.querySelectorAll(".milkdown-block-selected")
        .forEach((el) => el.classList.remove("milkdown-block-selected"));

      sourceEl = view.nodeDOM(fb.pos) as HTMLElement | null;
      if (!sourceEl) { cleanup(); return; }

      const srcRect    = sourceEl.getBoundingClientRect();
      grabOffsetY      = startY - srcRect.top;
      sourceInitialTop = srcRect.top;

      // ── 포털 (CSS 변수 상속을 위해 data-theme 복사) ──────────
      portalEl = document.createElement("div");
      portalEl.className = "milkdown drag-portal";
      portalEl.style.zIndex = "9990";
      const themeAttr = document.documentElement.getAttribute("data-theme");
      if (themeAttr) portalEl.setAttribute("data-theme", themeAttr);
      document.body.appendChild(portalEl);

      const proseWrapper = document.createElement("div");
      proseWrapper.className = "ProseMirror";
      portalEl.appendChild(proseWrapper);

      // ── 고스트 (원본 DOM 클론) ────────────────────────────────
      ghost = sourceEl.cloneNode(true) as HTMLElement;
      ghost.classList.remove("ProseMirror-selectednode", "selected", "milkdown-block-selected");
      ghost.querySelectorAll(".ProseMirror-selectednode, .selected, .milkdown-block-selected")
        .forEach((el) => el.classList.remove("ProseMirror-selectednode", "selected", "milkdown-block-selected"));
      Object.assign(ghost.style, {
        position: "fixed", pointerEvents: "none", opacity: "0.55", zIndex: "9999",
        left: `${srcRect.left}px`, top: `${srcRect.top}px`, width: `${srcRect.width}px`,
        margin: "0", background: "var(--bg-primary, #fff)", borderRadius: "6px",
        boxShadow: "0 8px 32px rgba(0,0,0,.22)", willChange: "transform", transition: "none",
      });
      proseWrapper.appendChild(ghost);

      // 멀티블록 뱃지
      if (selectedFlatBlocks.length > 1) {
        const badge = document.createElement("span");
        badge.textContent = String(selectedFlatBlocks.length);
        Object.assign(badge.style, {
          position: "absolute", top: "-8px", right: "-8px",
          background: "var(--accent, #3b82f6)", color: "#fff",
          borderRadius: "50%", width: "20px", height: "20px",
          fontSize: "11px", fontWeight: "700", lineHeight: "20px",
          textAlign: "center", pointerEvents: "none",
        });
        ghost.style.position = "relative";
        ghost.appendChild(badge);
        ghost.style.setProperty("position", "fixed");
      }

      // 원본 반투명 처리
      sourceEl.style.opacity = "0.25";
      if (selectedFlatBlocks.length > 1) {
        for (const b of selectedFlatBlocks) {
          if (b.pos === fb.pos) continue;
          const el = view.nodeDOM(b.pos) as HTMLElement | null;
          if (el) el.style.opacity = "0.25";
        }
      }

      // ── 드롭 인디케이터 ──────────────────────────────────────
      indicator = document.createElement("div");
      Object.assign(indicator.style, {
        position: "fixed", pointerEvents: "none", height: "2px",
        background: "var(--accent, #3b82f6)", zIndex: "9998", borderRadius: "2px",
        left: `${srcRect.left}px`, width: `${srcRect.width}px`, top: "-1000px",
        boxShadow: "0 0 0 3px rgba(59,130,246,.15)",
      });
      portalEl.appendChild(indicator);

      dragging = true;
      document.body.style.cursor = "grabbing";
    }

    // ── 드래그 중: 고스트 이동 + 인디케이터 위치 갱신 ─────────
    ghost!.style.transform =
      `translateY(${e.clientY - grabOffsetY - sourceInitialTop}px)`;

    const view = getView();
    if (view && indicator && selectedFlatBlocks.length > 0) {
      const skipPositions = new Set(selectedFlatBlocks.map((b) => b.pos));
      const srcLevel      = sourceFlatBlock?.level ?? 0;
      const result        = getDropTarget(view, e.clientY, skipPositions, srcLevel);
      if (result) {
        dropTarget = result;
        indicator.style.top = `${result.y - 1}px`;
      }
    }
  };

  const onPointerUp = () => {
    if (!dragging) {
      if (pending) {
        // 핸들 클릭 (드래그 없음) → 블록 선택 토글
        const view = getView();
        if (view) {
          const fb = findFlatBlockAtY(view, startY);
          if (fb) applyBlockClick(fb);
        }
      }
      pending = false;
      return;
    }

    const view   = getView();
    const src    = sourceFlatBlock;
    const dst    = dropTarget;
    const blocks = [...selectedFlatBlocks];

    // 멀티블록 반투명 복원
    if (view && blocks.length > 1) {
      for (const b of blocks) {
        const el = view.nodeDOM(b.pos) as HTMLElement | null;
        if (el) el.style.opacity = "";
      }
    }

    cleanup();
    clearBlockSelection();

    if (!view || !src || !dst || blocks.length === 0) return;

    const { doc } = view.state;
    const tr = view.state.tr;

    // ── A / A': 멀티블록 ──────────────────────────────────────────
    if (blocks.length > 1) {
      const allLevel0     = blocks.every((b) => b.level === 0);
      const allLevel1Same = !allLevel0 &&
        blocks.every((b) => b.level === 1 && b.parentPos === blocks[0].parentPos);

      if (!allLevel0 && !allLevel1Same) { view.focus(); return; }

      const firstPos  = blocks[0].pos;
      const lastBlock = blocks[blocks.length - 1];
      const lastPos   = lastBlock.pos + lastBlock.size;
      if (dst.pos >= firstPos && dst.pos <= lastPos) return;

      const nodes = blocks
        .map((b) => doc.nodeAt(b.pos))
        .filter((n): n is PMNode => n !== null);
      if (!nodes.length) return;

      tr.delete(firstPos, lastPos);

      if (allLevel1Same) {
        if (blocks[0].parentChildCount === blocks.length) {
          const emptyListPos  = tr.mapping.map(blocks[0].parentPos!);
          const emptyListNode = tr.doc.nodeAt(emptyListPos);
          if (emptyListNode && emptyListNode.childCount === 0) {
            tr.delete(emptyListPos, emptyListPos + emptyListNode.nodeSize);
          }
        }
        if (dst.inList) {
          tr.insert(tr.mapping.map(dst.pos), Fragment.from(nodes));
        } else {
          const lifted: PMNode[] = [];
          nodes.forEach((n) => n.forEach((child) => lifted.push(child)));
          if (!lifted.length) { view.focus(); return; }
          tr.insert(tr.mapping.map(dst.pos), Fragment.from(lifted));
        }
      } else {
        if (dst.inList) {
          tr.insert(tr.mapping.map(dst.pos), Fragment.from(nodes.map((n) => wrapInListItem(view, n))));
        } else {
          tr.insert(tr.mapping.map(dst.pos), Fragment.from(nodes));
        }
      }

      view.dispatch(tr);
      view.focus();
      return;
    }

    // ── B / B' / C / D: 단일 블록 ────────────────────────────────
    const node = doc.nodeAt(src.pos);
    if (!node) return;

    if (src.level === 0) {
      if (dst.pos === src.pos || dst.pos === src.pos + src.size) return;
      if (src.pos < 0 || src.pos + src.size > doc.content.size) return;
      tr.delete(src.pos, src.pos + src.size);
      if (dst.inList) {
        tr.insert(tr.mapping.map(dst.pos), wrapInListItem(view, node));
      } else {
        tr.insert(tr.mapping.map(dst.pos), node);
      }
    } else if (src.level === 1) {
      if (dst.pos === src.pos || dst.pos === src.pos + src.size) return;

      if (dst.inList) {
        tr.delete(src.pos, src.pos + src.size);
        if ((src.parentChildCount ?? 0) === 1) {
          const emptyListPos  = tr.mapping.map(src.parentPos!);
          const emptyListNode = tr.doc.nodeAt(emptyListPos);
          if (emptyListNode && emptyListNode.childCount === 0) {
            tr.delete(emptyListPos, emptyListPos + emptyListNode.nodeSize);
          }
        }
        tr.insert(tr.mapping.map(dst.pos), node);
      } else {
        if (node.childCount === 0) return;
        tr.delete(src.pos, src.pos + src.size);
        if ((src.parentChildCount ?? 0) === 1) {
          const emptyListPos  = tr.mapping.map(src.parentPos!);
          const emptyListNode = tr.doc.nodeAt(emptyListPos);
          if (emptyListNode && emptyListNode.childCount === 0) {
            tr.delete(emptyListPos, emptyListPos + emptyListNode.nodeSize);
          }
        }
        tr.insert(tr.mapping.map(dst.pos), node.content);
      }
    }

    view.dispatch(tr);
    view.focus();
  };

  // ── Escape → 선택 해제 ────────────────────────────────────────
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (dragging) { cleanup(); return; }
      if (selectedPositions.size > 0) clearBlockSelection();
    }
  };

  // ════════════════════════════════════════════════════════════════
  // 핸들 설정 (setupBlockHandles에서 mousemove/scroll/resize 처리)
  // ════════════════════════════════════════════════════════════════
  const cleanupHandles = setupBlockHandles(
    containerEl,
    () => pending || dragging,
  );

  // ════════════════════════════════════════════════════════════════
  // 이벤트 등록
  // ════════════════════════════════════════════════════════════════
  window.addEventListener("dragstart",   onDragStart,   true);
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup",   onPointerUp);
  window.addEventListener("keydown",     onKeyDown);

  return () => {
    cleanupHandles();
    window.removeEventListener("dragstart",   onDragStart,   true);
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup",   onPointerUp);
    window.removeEventListener("keydown",     onKeyDown);
    cleanup();
    clearBlockSelection();
  };
}
