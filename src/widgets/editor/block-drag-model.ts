/**
 * block-drag-model.ts
 *
 * FlatBlock 타입 정의 + ProseMirror 문서를 "플랫 블록 목록"으로 변환하는 유틸.
 * 드롭 타겟 계산 로직도 여기에 둔다.
 *
 * ── FlatBlock 레벨 모델 ────────────────────────────────────────────
 *   level 0 → doc 직계 자식 (paragraph, heading, blockquote, …)
 *   level 1 → bulletList / orderedList 안의 listItem
 *
 * ── 트랜잭션 케이스 (block-drag.ts 참조) ─────────────────────────
 *   A  멀티블록(level-0), inList:false  → Fragment.from insert
 *   A' 멀티블록(level-0), inList:true   → 각 노드를 list_item 래핑 후 insert
 *   B  단일 level-0, inList:false       → 노드 그대로 이동
 *   B' 단일 level-0, inList:true        → list_item 래핑 후 이동
 *   C  단일 level-1, inList:true        → listItem 노드 이동
 *   D  단일 level-1, inList:false       → node.content 로 top-level lift
 */

import type { EditorView } from "@milkdown/prose/view";
import { Fragment } from "@milkdown/prose/model";
import type { Node as PMNode } from "@milkdown/prose/model";

// ── 타입 ──────────────────────────────────────────────────────────

export interface FlatBlock {
  pos:              number;   // ProseMirror 절대 위치
  size:             number;   // node.nodeSize
  level:            number;   // 0 = top-level, 1 = listItem
  node:             PMNode;
  parentPos?:       number;   // level 1: 부모 list 절대 위치
  parentEnd?:       number;   // level 1: 부모 list 닫는 위치
  parentChildCount?: number;  // level 1: 부모 list 자식 수
  top:              number;   // getBoundingClientRect().top
  bottom:           number;   // getBoundingClientRect().bottom
}

export interface DropTarget {
  pos:    number;
  y:      number;
  inList: boolean;
}

// ── 플랫 블록 목록 ────────────────────────────────────────────────

export function getFlatBlocks(view: EditorView): FlatBlock[] {
  const out: FlatBlock[] = [];
  const listTypes = ["bullet_list", "ordered_list"];

  view.state.doc.forEach((topNode, topOffset) => {
    if (listTypes.includes(topNode.type.name)) {
      topNode.forEach((item, itemOffset) => {
        const itemPos = topOffset + 1 + itemOffset;
        const el = view.nodeDOM(itemPos) as HTMLElement | null;
        if (!el) return;
        const r = el.getBoundingClientRect();
        out.push({
          pos: itemPos, size: item.nodeSize, level: 1, node: item,
          parentPos:        topOffset,
          parentEnd:        topOffset + topNode.nodeSize,
          parentChildCount: topNode.childCount,
          top: r.top, bottom: r.bottom,
        });
      });
    } else {
      const el = view.nodeDOM(topOffset) as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      out.push({
        pos: topOffset, size: topNode.nodeSize, level: 0, node: topNode,
        top: r.top, bottom: r.bottom,
      });
    }
  });

  return out;
}

export function findFlatBlockAtY(view: EditorView, y: number): FlatBlock | null {
  for (const b of getFlatBlocks(view)) {
    if (y >= b.top - 8 && y <= b.bottom + 8) return b;
  }
  return null;
}

// ── 드롭 타겟 계산 ────────────────────────────────────────────────

function computeSlot(
  prev: FlatBlock | null,
  next: FlatBlock | null,
  srcLevel: number,
): DropTarget {
  if (
    prev && next &&
    prev.level === 1 && next.level === 1 &&
    prev.parentPos === next.parentPos
  ) {
    return { pos: next.pos, y: next.top, inList: true };
  }

  if (prev && !next && prev.level === 1) {
    if (srcLevel === 1) {
      return { pos: prev.pos + prev.size, y: prev.bottom, inList: true };
    } else {
      return { pos: prev.parentEnd!, y: prev.bottom, inList: false };
    }
  }

  if (next) {
    if (next.level === 1 && srcLevel === 1) {
      return { pos: next.pos, y: next.top, inList: true };
    }
    const pos = next.level === 1 ? next.parentPos! : next.pos;
    return { pos, y: next.top, inList: false };
  }

  const pos = prev ? prev.pos + prev.size : 0;
  return { pos, y: prev?.bottom ?? 0, inList: false };
}

export function getDropTarget(
  view: EditorView,
  mouseY: number,
  skipPositions: Set<number>,
  srcLevel: number,
): DropTarget | null {
  const all    = getFlatBlocks(view);
  const blocks = all.filter((b) => !skipPositions.has(b.pos));
  if (!blocks.length) return null;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (mouseY < (b.top + b.bottom) / 2) {
      const prev = i > 0 ? blocks[i - 1] : null;
      return computeSlot(prev, b, srcLevel);
    }
  }

  return computeSlot(blocks[blocks.length - 1], null, srcLevel);
}

// ── list_item 래핑 헬퍼 ───────────────────────────────────────────

export function wrapInListItem(view: EditorView, n: PMNode): PMNode {
  const listItemType = view.state.schema.nodes.list_item;
  if (!listItemType) return n;
  try { return listItemType.create(null, Fragment.from(n)); }
  catch { return n; }
}
