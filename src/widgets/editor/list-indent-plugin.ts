/**
 * list-indent-plugin.ts
 *
 * Tab        → list_item 들여쓰기 (하위 레벨)
 * Shift+Tab  → list_item 내어쓰기 (상위 레벨)
 *
 * 선택 범위의 list_item 전체에 적용.
 * @milkdown/prose/schema-list 경로로 import (prosemirror-schema-list 재수출).
 */

import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { sinkListItem, liftListItem } from "@milkdown/prose/schema-list";

export const listIndentPlugin = $prose(() =>
  new Plugin({
    key: new PluginKey("listIndent"),
    props: {
      handleKeyDown(view, event) {
        if (event.key !== "Tab") return false;

        // list_item 타입을 런타임 스키마에서 가져옴
        const listItemType = view.state.schema.nodes["list_item"];
        if (!listItemType) return false;

        // selection 범위에 list_item이 있는지 빠르게 확인
        const { $from, $to } = view.state.selection;
        let inList = false;
        view.state.doc.nodesBetween($from.pos, $to.pos, (node) => {
          if (node.type === listItemType) { inList = true; return false; }
        });
        if (!inList) return false;

        const cmd = event.shiftKey
          ? liftListItem(listItemType)
          : sinkListItem(listItemType);

        if (cmd(view.state, view.dispatch)) {
          event.preventDefault();
          return true;
        }
        return false;
      },
    },
  })
);
