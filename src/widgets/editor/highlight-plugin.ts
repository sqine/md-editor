/**
 * 형광펜(Highlight) 플러그인
 * - ==text== 문법으로 하이라이트 마크 적용
 * - remark 플러그인으로 markdown 파일 파싱/직렬화 지원
 */
import { $markSchema, $inputRule, $remark, $command } from "@milkdown/utils";
import { markRule } from "@milkdown/prose";
import { toggleMark } from "@milkdown/prose/commands";
import { findAndReplace } from "mdast-util-find-and-replace";

// ── 1. Mark Schema ────────────────────────────────────────────────
export const highlightSchema = $markSchema("highlight", () => ({
  parseDOM: [
    { tag: "mark" },
    {
      style: "background-color",
      getAttrs: (v: string | Node) =>
        typeof v === "string" &&
        (v.includes("#ff") || v.includes("yellow") || v.includes("rgba"))
          ? {}
          : false,
    },
  ],
  toDOM: () => ["mark", { class: "md-highlight" }, 0] as const,
  attrs: {},
  parseMarkdown: {
    match: (node: { type: string }) => node.type === "highlight",
    runner: (state: any, node: any, markType: any) => {
      state.openMark(markType);
      state.next(node.children);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark: any) => mark.type.name === "highlight",
    runner: (state: any, mark: any) => {
      state.withMark(mark, "highlight");
    },
  },
}));

// ── 2. Toggle Command ─────────────────────────────────────────────
export const toggleHighlightCommand = $command(
  "ToggleHighlight",
  (ctx) => () => toggleMark(highlightSchema.type(ctx))
);

// ── 3. Input Rule: ==text== ───────────────────────────────────────
// markRule은 마지막 캡처 그룹을 텍스트 내용으로 사용함
export const highlightInputRule = $inputRule((ctx) =>
  markRule(/(?<!=)==([^=\n]+)==(?!=)/, highlightSchema.type(ctx))
);

// ── 4. Remark Plugin: 파싱 + 직렬화 ─────────────────────────────
export const remarkHighlightPlugin = $remark(
  "remarkHighlight",
  () =>
    function (this: any) {
      const data = this.data() as Record<string, any>;

      // mdast-util-to-markdown 확장: "highlight" 노드 → ==text==
      (data.toMarkdownExtensions ??= []).push({
        handlers: {
          highlight: (
            node: any,
            _: any,
            state: any,
            info: any
          ): string => {
            const exit = state.enter("highlight");
            const value =
              "==" +
              state.containerPhrasing(node, {
                ...info,
                before: "=",
                after: "=",
              }) +
              "==";
            exit();
            return value;
          },
        },
      });

      // transformer: ==text== 텍스트 노드 → { type: "highlight" } mdast 노드
      return (tree: any) => {
        findAndReplace(tree, [
          [
            /==([^=\n]+)==/g,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (_match: string, content: string): any => ({
              type: "highlight",
              children: [{ type: "text", value: content }],
            }),
          ],
        ]);
      };
    }
);

// ── 전체 플러그인 묶음 ────────────────────────────────────────────
export const highlightPlugin = [
  highlightSchema,
  highlightInputRule,
  toggleHighlightCommand,
  remarkHighlightPlugin,
] as const;
