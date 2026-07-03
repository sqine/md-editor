import { useEffect, useRef, useState, useCallback } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Crepe } from "@milkdown/crepe";
import { CrepeFeature } from "@milkdown/crepe";
import "@milkdown/crepe/theme/frame.css";
import "@milkdown/crepe/theme/common/style.css";
import { $prose } from "@milkdown/kit/utils";
import { insertPos } from "@milkdown/utils";
import { inputRules, InputRule } from "@milkdown/kit/prose/inputrules";
import { languages } from "@codemirror/language-data";
import { syntaxHighlighting } from "@codemirror/language";
import { classHighlighter } from "@lezer/highlight";
import { Plugin, PluginKey, TextSelection } from "@milkdown/prose/state";
import { Decoration, DecorationSet } from "@milkdown/prose/view";
import { editorViewCtx, editorViewOptionsCtx } from "@milkdown/kit/core";
import { undoDepth, redoDepth } from "prosemirror-history";
import { uploadConfig } from "@milkdown/plugin-upload";
import { useApp, activeTab } from "../../shared/store/appStore";
import { highlightPlugin } from "./highlight-plugin";
import { tauriImageUploader, setCurrentFilePath } from "./image-uploader";
import { urlDropPlugin } from "./url-drop-plugin";
import { tableFocusPlugin } from "./table-focus-plugin";
import { listIndentPlugin } from "./list-indent-plugin";
import { normalizeExternalHtml } from "./paste-normalize";
import { ImageOverlay } from "./image-tools";
import TableContextMenu from "./TableContextMenu";
import "./Editor.css";

// ── URL 대상 범위 decoration (링크 팝업 열린 동안 표시) ──────────
const urlTargetKey = new PluginKey<{ from: number; to: number } | null>("urlTarget");

const urlTargetPlugin = $prose(() =>
  new Plugin({
    key: urlTargetKey,
    state: {
      init: () => null,
      apply(tr, val) {
        const meta = tr.getMeta(urlTargetKey);
        return meta !== undefined ? meta : val;
      },
    },
    props: {
      decorations(state) {
        const range = urlTargetKey.getState(state);
        if (!range) return DecorationSet.empty;
        return DecorationSet.create(state.doc, [
          Decoration.inline(range.from, range.to, { class: "pm-url-target" }),
        ]);
      },
    },
  })
);

/** 링크 팝업이 열릴 때 대상 텍스트 범위 decoration 표시 */
export function setUrlTargetRange(from: number, to: number) {
  const view = crepeInstance?.editor.action((ctx) => ctx.get(editorViewCtx));
  if (!view) return;
  view.dispatch(view.state.tr.setMeta(urlTargetKey, { from, to }));
}

/** 링크 팝업이 닫힐 때 decoration 해제 */
export function clearUrlTargetRange() {
  const view = crepeInstance?.editor.action((ctx) => ctx.get(editorViewCtx));
  if (!view) return;
  view.dispatch(view.state.tr.setMeta(urlTargetKey, null));
}

// ── 타이포그래피 입력 규칙 ────────────────────────────────────────
const typographyPlugin = $prose(() =>
  inputRules({
    rules: [
      new InputRule(/--$/, (state, _match, start, end) =>
        state.tr.replaceWith(start, end, state.schema.text("—"))
      ),
      new InputRule(/\.\.\.$/, (state, _match, start, end) =>
        state.tr.replaceWith(start, end, state.schema.text("…"))
      ),
      new InputRule(/(^|[\s(])"$/, (state, _match, _start, end) =>
        state.tr.replaceWith(end - 1, end, state.schema.text("“"))
      ),
      new InputRule(/\w"$/, (state, _match, _start, end) =>
        state.tr.replaceWith(end - 1, end, state.schema.text("“"))
      ),
    ],
  })
);

export let crepeInstance: Crepe | null = null;

interface Props { initialContent: string; }

export default function Editor({ initialContent }: Props) {
  const containerRef   = useRef<HTMLDivElement>(null);
  const crepeRef       = useRef<Crepe | null>(null);
  const { state, dispatch } = useApp();
  const [error, setError]   = useState<string | null>(null);
  const [ready, setReady]   = useState(false);
  const [linkPreview, setLinkPreview] = useState<{
    href: string; x: number; y: number; from: number; to: number;
  } | null>(null);
  const linkPreviewRef = useRef<HTMLDivElement>(null);

  // 현재 파일 경로를 uploader에 동기화
  useEffect(() => {
    const tab = activeTab(state);
    setCurrentFilePath(tab.filePath ?? null);
  }, [state.activeTabId, state.tabs]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let crepe: Crepe;
    try {
      // Crepe는 생성자에서 대부분의 기능(table, listItem, latex, codeMirror,
      // placeholder, imageBlock, cursor, linkTooltip, upload)을 기본 등록.
      // addFeature()로 다시 추가하면 플러그인이 중복 등록되어 오작동 → featureConfigs 사용.
      crepe = new Crepe({
        root: el,
        defaultValue: initialContent,
        features: {
          [CrepeFeature.Toolbar]:    false,  // 우리 툴바 사용
          [CrepeFeature.BlockEdit]:  false,  // 슬래시 메뉴 + 블록 핸들 모두 제거 (gutter drag로 대체)
          [CrepeFeature.Cursor]:     false,  // prosemirror-virtual-cursor가 네이티브 캐럿과 겹쳐 이상해 보임
        },
        featureConfigs: {
          [CrepeFeature.CodeMirror]: {
            languages,
            noResultText: "결과 없음 — Enter로 적용",
            // classHighlighter → DOM에 .tok-keyword/.tok-string 등 클래스 생성
            // → Editor.css의 [data-theme] 규칙으로 라이트/다크 색상 오버라이드 가능
            extensions: [syntaxHighlighting(classHighlighter)],
          },
          [CrepeFeature.Placeholder]: { text: "마크다운을 입력하세요…" },
        },
      });
    } catch (e) {
      setError(String(e));
      return;
    }

    // ── 커스텀 플러그인 (Crepe 기본값에 없는 것만) ──────────────────
    crepe.editor.use(typographyPlugin);
    for (const p of highlightPlugin) crepe.editor.use(p);
    crepe.editor.use(urlDropPlugin);
    crepe.editor.use(urlTargetPlugin);
    crepe.editor.use(tableFocusPlugin);
    crepe.editor.use(listIndentPlugin);

    // Crepe에 포함된 upload 플러그인의 uploader를 Tauri 전용으로 교체
    // + blockConfig: list_item 포함 모든 블록에 핸들 표시
    crepe.editor.config((ctx) => {
      // ── 클립보드 서식 보존 ────────────────────────────────────────
      // Milkdown clipboard 플러그인의 transformPastedHTML 이전(prev) 단계로 삽입.
      // 체인 순서: 우리 정규화 → Milkdown Google Docs 정리 (두 단계 모두 적용됨)
      ctx.update(editorViewOptionsCtx, (prev) => ({
        ...prev,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        transformPastedHTML: (html: string, view: any) => {
          // prev.transformPastedHTML이 있으면 먼저 실행 (Milkdown 내부 체인)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if ((prev as any).transformPastedHTML) html = (prev as any).transformPastedHTML(html, view);
          // 외부 소스 인라인 스타일 → 시맨틱 태그 정규화
          return normalizeExternalHtml(html);
        },
      }));

      ctx.update(uploadConfig.key, (prev) => ({
        ...prev,
        uploader: tauriImageUploader as any,
        enableHtmlFileUploader: false,
      }));
    });

    crepe
      .on((api) => {
        api.markdownUpdated((ctx, markdown, prev) => {
          if (markdown === prev) return;
          dispatch({ type: "SET_CONTENT", content: markdown });
          const view = ctx.get(editorViewCtx);
          dispatch({
            type: "SET_HISTORY_STATE",
            canUndo: undoDepth(view.state) > 0,
            canRedo: redoDepth(view.state) > 0,
          });
        });
      });

    crepe.create()
      .then(() => {
        crepeRef.current = crepe;
        crepeInstance    = crepe;
        setReady(true);
      })
      .catch((e) => setError(String(e)));

    return () => {
      crepe.destroy().catch(() => {});
      crepeRef.current = null;
      crepeInstance    = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // URL 드롭 이벤트 처리 (urlDropPlugin → CustomEvent → 여기서 삽입)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handler = (e: Event) => {
      const { markdown, pos } = (e as CustomEvent).detail as {
        markdown: string;
        pos: number;
      };
      crepeInstance?.editor.action(insertPos(markdown, pos, true));
    };

    el.addEventListener("md-url-drop", handler);

    // ── 링크 클릭 → URL 프리뷰 툴팁 표시 ───────────────────────────
    const onEditorClick = (e: MouseEvent) => {
      // 툴팁 자체를 클릭한 경우 무시 (툴팁 내부 버튼이 처리)
      if (linkPreviewRef.current?.contains(e.target as Node)) return;

      const view = crepeRef.current?.editor.action((ctx) => ctx.get(editorViewCtx));
      if (!view) { setLinkPreview(null); return; }

      let href: string | null = null;
      let tipX = e.clientX;
      let tipY = e.clientY + 20;
      let linkFrom = -1, linkTo = -1;

      // 1. DOM 방식: <a> 태그로 위치 계산
      const a = (e.target as Element).closest?.("a");
      if (a) {
        href = a.getAttribute("href");
        const r = a.getBoundingClientRect();
        tipX = r.left;
        tipY = r.bottom + 6;
      }

      // 2. ProseMirror 방식: link mark + 전체 범위 탐색
      const coords = view.posAtCoords({ left: e.clientX, top: e.clientY });
      if (coords) {
        try {
          const pos = coords.pos;
          const $pos = view.state.doc.resolve(pos);
          const linkType = view.state.schema.marks.link;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const lm = linkType ? $pos.marks().find((m: any) => m.type === linkType) : null;
          if (lm) {
            if (!href) href = lm.attrs.href as string;
            // 링크 mark 전체 범위 탐색
            let f = pos, t = pos;
            while (f > 0) {
              try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                if (view.state.doc.resolve(f - 1).marks().some((m: any) => m.type === linkType)) f--;
                else break;
              } catch { break; }
            }
            while (t < view.state.doc.content.size) {
              try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                if (view.state.doc.resolve(t).marks().some((m: any) => m.type === linkType)) t++;
                else break;
              } catch { break; }
            }
            linkFrom = f;
            linkTo   = t;
          }
        } catch { /* invalid pos */ }
      }

      setLinkPreview(href && linkFrom >= 0
        ? { href, x: tipX, y: tipY, from: linkFrom, to: linkTo }
        : null,
      );
    };

    // 툴팁 바깥 mousedown → 닫기
    const onOutsideDown = (e: MouseEvent) => {
      if (!linkPreviewRef.current?.contains(e.target as Node)) {
        setLinkPreview(null);
      }
    };

    // 스크롤 시 툴팁 닫기
    const onScroll = () => setLinkPreview(null);
    const milkdownEl = el.querySelector(".milkdown");

    el.addEventListener("click", onEditorClick);
    document.addEventListener("mousedown", onOutsideDown, true);
    milkdownEl?.addEventListener("scroll", onScroll);

    // ── 코드블록 언어 직접 입력 ────────────────────────────────────
    // 목록에 없는 언어명을 검색창에 입력 후 Enter → 직접 적용
    const onCodeLangKeydown = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      const target = e.target as HTMLElement;
      if (!target.classList.contains("search-input")) return;

      const typed = (target as HTMLInputElement).value.trim();
      if (!typed) return;

      // 검색 결과가 없을 때만 커스텀 언어로 적용
      const picker = target.closest(".language-picker");
      if (!picker?.querySelector(".no-result")) return;

      const codeBlock = target.closest(".milkdown-code-block") as HTMLElement | null;
      if (!codeBlock) return;

      const view = crepeRef.current?.editor.action((ctx) => ctx.get(editorViewCtx));
      if (!view) return;

      try {
        // posAtDOM(nodeViewDom, 0) → 노드 콘텐츠 시작 위치 → -1 = 노드 자체 위치
        const pos = view.posAtDOM(codeBlock, 0) - 1;
        const node = view.state.doc.nodeAt(pos);
        if (node) {
          view.dispatch(view.state.tr.setNodeAttribute(pos, "language", typed));
          // 피커 닫기
          codeBlock.querySelector<HTMLElement>(".language-button")?.click();
        }
      } catch { /* out-of-range 무시 */ }

      e.preventDefault();
      e.stopPropagation();
    };
    el.addEventListener("keydown", onCodeLangKeydown, true);

    return () => {
      el.removeEventListener("md-url-drop", handler);
      el.removeEventListener("click", onEditorClick);
      document.removeEventListener("mousedown", onOutsideDown, true);
      milkdownEl?.removeEventListener("scroll", onScroll);
      el.removeEventListener("keydown", onCodeLangKeydown, true);
    };
  }, [ready]);

  // ── 이미지 노드 src 업데이트 (크롭/리사이즈 후 호출) ────────────
  const handleImageSrcChange = useCallback((nodePos: number, newSrc: string) => {
    const view = crepeRef.current?.editor.action((ctx) => ctx.get(editorViewCtx));
    if (!view) return;
    const node = view.state.doc.nodeAt(nodePos);
    if (!node) return;
    // 쿼리스트링 제거 후 실제 파일 경로만 저장
    const cleanSrc = newSrc.split("?")[0];
    const tr = view.state.tr.setNodeMarkup(nodePos, null, { ...node.attrs, src: cleanSrc });
    view.dispatch(tr);
  }, []);

  // ── 클릭한 image-block DOM → ProseMirror pos 변환 ──────────────
  const getPosFromEl = useCallback((el: HTMLElement): number | null => {
    const view = crepeRef.current?.editor.action((ctx) => ctx.get(editorViewCtx));
    if (!view) return null;
    // NodeView의 dom은 .milkdown-image-block div → pos 조회
    const pos = view.posAtDOM(el, 0);
    // posAtDOM은 블록 바로 앞 위치를 반환하므로 +1
    const resolved = view.state.doc.resolve(pos);
    // 실제 image-block 노드 위치
    return resolved.pos;
  }, []);

  if (error) {
    return (
      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: 32, color: "#ef4444", gap: 12,
      }}>
        <strong>에디터 초기화 실패</strong>
        <pre style={{ fontSize: 12, background: "#fef2f2", padding: 12, borderRadius: 6,
          maxWidth: 560, overflowX: "auto", color: "#991b1b" }}>
          {error}
        </pre>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", position: "relative" }}>
      {/* 링크 프리뷰 툴팁 */}
      {linkPreview && (
        <div
          ref={linkPreviewRef}
          className="editor-link-preview"
          style={{
            left: Math.min(linkPreview.x, window.innerWidth - 380),
            top:  linkPreview.y,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 14, flexShrink: 0, color: "var(--link)" }}>link</span>
          <span
            className="editor-link-preview-url editor-link-preview-url-clickable"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const url = /^https?:\/\//i.test(linkPreview.href) ? linkPreview.href : `https://${linkPreview.href}`;
              openUrl(url).catch(() => {});
              setLinkPreview(null);
            }}
          >{linkPreview.href}</span>

          {/* 브라우저에서 열기 */}
          <button
            className="editor-link-preview-btn"
            title="브라우저에서 열기"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const url = /^https?:\/\//i.test(linkPreview.href) ? linkPreview.href : `https://${linkPreview.href}`;
              openUrl(url).catch(() => {});
              setLinkPreview(null);
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>open_in_new</span>
          </button>

          {/* 수정: 링크 범위를 선택 후 툴바 링크 팝업 열기 */}
          <button
            className="editor-link-preview-btn"
            title="링크 수정"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const view = crepeRef.current?.editor.action((ctx) => ctx.get(editorViewCtx));
              if (view) {
                const sel = TextSelection.create(view.state.doc, linkPreview.from, linkPreview.to);
                view.dispatch(view.state.tr.setSelection(sel));
                view.focus();
              }
              setLinkPreview(null);
              // 툴바 링크 팝업 열기 요청
              window.dispatchEvent(new CustomEvent("md-link-edit"));
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>edit</span>
          </button>

          {/* 삭제: 링크 mark 제거 (nodesBetween으로 전체 범위 보장) */}
          <button
            className="editor-link-preview-btn editor-link-preview-btn-danger"
            title="링크 제거"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const view = crepeRef.current?.editor.action((ctx) => ctx.get(editorViewCtx));
              if (view) {
                const linkType = view.state.schema.marks.link;
                if (linkType) {
                  // nodesBetween으로 연속된 link mark 전체 범위 확장
                  let f = linkPreview.from, t = linkPreview.to;
                  view.state.doc.nodesBetween(0, view.state.doc.content.size, (node: any, pos: number) => {
                    if (!node.isText) return true;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    if (!node.marks.some((m: any) => m.type === linkType)) return;
                    const nodeEnd = pos + node.nodeSize;
                    if (pos <= t && nodeEnd >= f) { f = Math.min(f, pos); t = Math.max(t, nodeEnd); }
                  });
                  view.dispatch(view.state.tr.removeMark(f, t, linkType));
                }
                view.focus();
              }
              setLinkPreview(null);
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>link_off</span>
          </button>
        </div>
      )}

      {!ready && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--text-muted)", fontSize: 13, pointerEvents: "none",
        }}>
          에디터 로딩 중…
        </div>
      )}
      <div
        ref={containerRef}
        id="milkdown-container"
        spellCheck={false}
        style={{ flex: 1, minHeight: 0 }}
      />
      <TableContextMenu />
      {/* 이미지 크롭/리사이즈 오버레이 — ready 후에만 마운트 */}
      {ready && containerRef.current && (
        <ImageOverlay
          containerEl={containerRef.current}
          onSrcChange={handleImageSrcChange}
          getPosFromEl={getPosFromEl}
        />
      )}
    </div>
  );
}
