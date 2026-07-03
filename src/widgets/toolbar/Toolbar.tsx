import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { callCommand } from "@milkdown/utils";
import { insert } from "@milkdown/utils";
import { undoCommand, redoCommand } from "@milkdown/plugin-history";
import {
  toggleStrongCommand,
  toggleEmphasisCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  wrapInBlockquoteCommand,
  insertHrCommand,
} from "@milkdown/preset-commonmark";
import { toggleStrikethroughCommand } from "@milkdown/preset-gfm";
import { editorViewCtx } from "@milkdown/kit/core";
import { open as openDialog, save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useApp, activeTab } from "../../shared/store/appStore";
import { useFile } from "../../features/file/useFile";
import { useToast } from "../../shared/ui/Toast";
import { crepeInstance, setUrlTargetRange, clearUrlTargetRange } from "../editor/Editor";
import { toggleHighlightCommand } from "../editor/highlight-plugin";
import { buildPdfHtml } from "../../features/export/exportHtml";
import "./Toolbar.css";

function cmd(command: Parameters<typeof callCommand>[0]) {
  crepeInstance?.editor.action(callCommand(command));
}

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <span
      className="material-symbols-outlined"
      style={{ fontSize: size, lineHeight: 1, userSelect: "none" }}
    >
      {name}
    </span>
  );
}

/** Btn: onMouseDown에서 preventDefault → 클릭 시 에디터 포커스/selection 유지 */
const Btn = React.forwardRef<HTMLButtonElement, {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
  active?: boolean;
  disabled?: boolean;
}>(function Btn({ children, onClick, title, active, disabled }, ref) {
  return (
    <button
      ref={ref}
      className={`tb-btn${active ? " tb-btn-active" : ""}${disabled ? " tb-btn-disabled" : ""}`}
      onMouseDown={(e) => { if (!disabled) e.preventDefault(); }}
      onClick={disabled ? undefined : onClick}
      title={title}
      disabled={disabled}
    >
      {children}
    </button>
  );
});

function Sep() {
  return <div className="tb-sep" />;
}

// ── 링크 팝업 ─────────────────────────────────────────────────────

/**
 * from~to 범위가 포함하는 link mark의 전체 연속 범위로 확장한다.
 * $pos.marks()는 블록 경계·커서 위치에 따라 신뢰하기 어려워
 * nodesBetween으로 텍스트 노드를 직접 순회하는 방식을 사용한다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function expandToFullLinkRange(doc: any, from: number, to: number, linkType: any) {
  let f = from, t = to;
  doc.nodesBetween(0, doc.content.size, (node: any, pos: number) => {
    if (!node.isText) return true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!node.marks.some((m: any) => m.type === linkType)) return;
    const nodeEnd = pos + node.nodeSize;
    // 현재 [f, t] 범위와 겹치거나 인접한 link 텍스트 노드가 있으면 확장
    if (pos <= t && nodeEnd >= f) {
      f = Math.min(f, pos);
      t = Math.max(t, nodeEnd);
    }
  });
  return { from: f, to: t };
}

/** 특정 position을 감싸는 link mark의 전체 범위와 href를 반환 */
function getLinkBounds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  view: any,
  pos: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  linkType: any,
): { from: number; to: number; href: string } | null {
  const doc = view.state.doc;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let href = "";
  let f = -1, t = -1;

  // nodesBetween으로 커서 위치를 포함하는 link 텍스트 노드 탐색 후 연속 범위 확장
  doc.nodesBetween(0, doc.content.size, (node: any, nodePos: number) => {
    if (!node.isText) return true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lm = node.marks.find((m: any) => m.type === linkType);
    if (!lm) return;
    const nodeEnd = nodePos + node.nodeSize;
    if (nodePos <= pos && nodeEnd >= pos) {
      // 커서를 포함하는 노드 발견 → href 기록, 초기 범위 설정
      href = (lm.attrs.href as string) || "";
      f = nodePos;
      t = nodeEnd;
    }
  });
  if (f < 0) return null;

  // 같은 href를 가진 인접 노드로 범위 확장
  doc.nodesBetween(0, doc.content.size, (node: any, nodePos: number) => {
    if (!node.isText) return true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lm = node.marks.find((m: any) => m.type === linkType);
    if (!lm || lm.attrs.href !== href) return;
    const nodeEnd = nodePos + node.nodeSize;
    if (nodePos <= t && nodeEnd >= f) {
      f = Math.min(f, nodePos);
      t = Math.max(t, nodeEnd);
    }
  });

  return { from: f, to: t, href };
}

// ── 공용 Portal 팝업 래퍼 ───────────────────────────────────────────
/**
 * ToolbarPortalPopup
 * 툴바 버튼 아래에 fixed 위치로 띄우는 범용 portal 래퍼.
 * - 외부 클릭 시 onClose 호출
 * - 화면 오른쪽을 벗어나지 않도록 left 조정
 */
function ToolbarPortalPopup({
  anchorRect,
  onClose,
  width = 240,
  className = "",
  children,
}: {
  anchorRect: DOMRect;
  onClose: () => void;
  width?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!popupRef.current?.contains(e.target as Node)) onClose();
    };
    setTimeout(() => window.addEventListener("mousedown", handler), 0);
    return () => window.removeEventListener("mousedown", handler);
  }, [onClose]);

  const left = Math.min(anchorRect.left, window.innerWidth - width - 8);
  const top  = anchorRect.bottom + 6;

  return createPortal(
    <div
      ref={popupRef}
      className={`tb-portal-popup${className ? " " + className : ""}`}
      style={{ left, top, width }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

// ── 링크 팝업 (portal) ──────────────────────────────────────────────
function LinkPopup({ anchorRect, onClose }: { anchorRect: DOMRect; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [hasSelection, setHasSelection] = useState(false); // 텍스트 선택 or 기존 링크 위 커서
  const inputRef = useRef<HTMLInputElement>(null);
  const savedSel = useRef<{ from: number; to: number } | null>(null);

  useEffect(() => {
    const view = crepeInstance?.editor.action((ctx) => ctx.get(editorViewCtx));
    if (view) {
      const { from, to } = view.state.selection;
      const linkType = view.state.schema.marks.link;

      if (from < to) {
        savedSel.current = { from, to };
        if (linkType) {
          let found = "";
          view.state.doc.nodesBetween(from, to, (node: any) => {
            if (found) return false;
            const m = node.marks.find((mk: any) => mk.type === linkType);
            if (m) found = (m.attrs.href as string) || "";
          });
          setUrl(found);
        }
      } else if (linkType) {
        const bounds = getLinkBounds(view, from, linkType);
        if (bounds) {
          savedSel.current = { from: bounds.from, to: bounds.to };
          setUrl(bounds.href);
        } else {
          savedSel.current = { from, to };
        }
      } else {
        savedSel.current = { from, to };
      }
    }
    const sel = savedSel.current;
    const selectionExists = !!(sel && sel.from < sel.to);
    setHasSelection(selectionExists);
    if (selectionExists) setUrlTargetRange(sel!.from, sel!.to);

    requestAnimationFrame(() => inputRef.current?.focus());
    return () => clearUrlTargetRange();
  }, []);  // onClose 제거 — 외부클릭은 ToolbarPortalPopup이 처리

  const getView = () =>
    crepeInstance?.editor.action((ctx) => ctx.get(editorViewCtx)) ?? null;

  const apply = () => {
    const view = getView();
    const sel  = savedSel.current;
    if (!view || !sel) { onClose(); return; }

    const linkType = view.state.schema.marks.link;
    if (!linkType) { onClose(); return; }

    const { from, to } = sel;
    const href = url.trim();
    let tr = view.state.tr;

    if (from === to && href) {
      const textNode = view.state.schema.text(href, [linkType.create({ href })]);
      tr = tr.insert(from, textNode);
    } else if (href) {
      tr = tr.addMark(from, to, linkType.create({ href }));
    } else {
      const expanded = expandToFullLinkRange(view.state.doc, from, to, linkType);
      tr = tr.removeMark(expanded.from, expanded.to, linkType);
    }

    view.dispatch(tr);
    view.focus();
    onClose();
  };

  const remove = () => {
    const view = getView();
    const sel  = savedSel.current;
    if (view && sel) {
      const linkType = view.state.schema.marks.link;
      if (linkType) {
        const expanded = expandToFullLinkRange(view.state.doc, sel.from, sel.to, linkType);
        view.dispatch(view.state.tr.removeMark(expanded.from, expanded.to, linkType));
      }
      view.focus();
    }
    onClose();
  };

  return (
    <ToolbarPortalPopup anchorRect={anchorRect} onClose={onClose} width={320} className="tb-link-portal">
      {/* URL 입력 행 */}
      <div className="tb-link-portal-row">
        <span className="material-symbols-outlined tb-link-portal-icon">link</span>
        <div className="tb-link-input-wrap">
          <input
            ref={inputRef}
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter")  { e.preventDefault(); apply(); }
              if (e.key === "Escape") { onClose(); }
            }}
            placeholder="https://..."
            className="tb-link-portal-input"
            autoComplete="off"
            spellCheck={false}
          />
          {url && (
            <button
              className="tb-link-clear"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setUrl(""); inputRef.current?.focus(); }}
              title="지우기"
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
      </div>

      {/* 액션 버튼 행 */}
      <div className="tb-link-portal-actions">
        {url && (
          <button
            className="tb-link-portal-btn tb-link-portal-btn-ghost"
            onMouseDown={(e) => e.preventDefault()}
            onClick={remove}
            title="링크 제거"
          >
            <Icon name="link_off" size={15} />
            제거
          </button>
        )}
        <button
          className="tb-link-portal-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={apply}
          title={`${hasSelection ? "적용" : "입력"} (Enter)`}
        >
          <Icon name="check" size={15} />
          {hasSelection ? "적용" : "입력"}
        </button>
      </div>
    </ToolbarPortalPopup>
  );
}

// ── 표 삽입 팝업 ────────────────────────────────────────────────────
const TABLE_MAX = 8;

function TablePopup({ anchorRect, onClose }: { anchorRect: DOMRect; onClose: () => void }) {
  const [hovered, setHovered] = useState<[number, number]>([3, 3]);
  const [inputRows, setInputRows] = useState("");
  const [inputCols, setInputCols] = useState("");

  const rows = inputRows ? Math.max(1, Math.min(100, parseInt(inputRows) || 1)) : hovered[0];
  const cols = inputCols ? Math.max(1, Math.min(100, parseInt(inputCols) || 1)) : hovered[1];

  const insertTable = useCallback((r: number, c: number) => {
    const header  = `| ${Array(c).fill("   ").join(" | ")} |`;
    const divider = `| ${Array(c).fill("---").join(" | ")} |`;
    const dataRow = `| ${Array(c).fill("   ").join(" | ")} |`;
    const body    = Array(Math.max(1, r - 1)).fill(dataRow).join("\n");
    crepeInstance?.editor.action(insert(`\n\n${header}\n${divider}\n${body}\n\n`));
    onClose();
  }, [onClose]);

  return (
    <ToolbarPortalPopup anchorRect={anchorRect} onClose={onClose} width={196} className="tb-table-portal">
      <div className="tb-table-portal-label">{rows} × {cols} 표</div>

      <div className="tb-table-grid" onMouseLeave={() => { if (!inputRows && !inputCols) setHovered([3, 3]); }}>
        {Array.from({ length: TABLE_MAX }).map((_, r) => (
          <div key={r} className="tb-table-grid-row">
            {Array.from({ length: TABLE_MAX }).map((_, c) => (
              <div
                key={c}
                className={"tb-table-grid-cell" + (r < rows && c < cols ? " tb-table-grid-cell-active" : "")}
                onMouseEnter={() => { setInputRows(""); setInputCols(""); setHovered([r + 1, c + 1]); }}
                onClick={() => insertTable(r + 1, c + 1)}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="tb-table-inputs">
        <input className="tb-table-input" type="number" min={1} max={100} placeholder="행"
          value={inputRows} onChange={(e) => setInputRows(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") insertTable(rows, cols); }} />
        <span className="tb-table-inputs-x">×</span>
        <input className="tb-table-input" type="number" min={1} max={100} placeholder="열"
          value={inputCols} onChange={(e) => setInputCols(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") insertTable(rows, cols); }} />
        <button className="tb-table-insert-btn" onClick={() => insertTable(rows, cols)}>삽입</button>
      </div>
    </ToolbarPortalPopup>
  );
}

export default function Toolbar() {
  const { state, dispatch } = useApp();
  const { newFile, openFile, saveFile, saveFileAs } = useFile();
  const { error } = useToast();

  const tab = activeTab(state);

  // ── Open dropdown ──────────────────────────────────────────────
  const [openMenuVisible, setOpenMenuVisible] = useState(false);
  const openMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenuVisible) return;
    const handler = (e: MouseEvent) => {
      if (!openMenuRef.current?.contains(e.target as Node)) {
        setOpenMenuVisible(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [openMenuVisible]);

  const handleOpenFile = async () => {
    setOpenMenuVisible(false);
    await openFile();
  };

  const handleOpenFolder = async () => {
    setOpenMenuVisible(false);
    try {
      const folder = await openDialog({ directory: true }) as string | null;
      if (!folder) return;
      dispatch({ type: "SET_SIDEBAR_FOLDER", folder });
      if (!state.sidebarOpen) dispatch({ type: "TOGGLE_SIDEBAR" });
    } catch (e) {
      error("폴더를 열 수 없습니다", String(e));
    }
  };

  // ── Save dropdown ─────────────────────────────────────────────
  const [saveMenuVisible, setSaveMenuVisible] = useState(false);
  const saveMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!saveMenuVisible) return;
    const handler = (e: MouseEvent) => {
      if (!saveMenuRef.current?.contains(e.target as Node)) {
        setSaveMenuVisible(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [saveMenuVisible]);

  // ── Link popup ─────────────────────────────────────────────────
  const [linkPopupOpen, setLinkPopupOpen] = useState(false);
  const [linkAnchorRect, setLinkAnchorRect] = useState<DOMRect | null>(null);
  const linkBtnRef = useRef<HTMLButtonElement>(null);

  // 에디터 링크 프리뷰 툴팁에서 "수정" 버튼 클릭 시 팝업 열기
  useEffect(() => {
    const handler = () => {
      const rect = linkBtnRef.current?.getBoundingClientRect() ?? null;
      setLinkAnchorRect(rect);
      setLinkPopupOpen(true);
    };
    window.addEventListener("md-link-edit", handler);
    return () => window.removeEventListener("md-link-edit", handler);
  }, []);

  // ── PDF 내보내기 ───────────────────────────────────────────────
  const exportPdf = async () => {
    try {
      const path = await save({
        filters:     [{ name: "PDF", extensions: ["pdf"] }],
        defaultPath: tab.fileName.replace(/\.md$/, ".pdf"),
      }) as string | null;
      if (!path) return;
      await invoke("export_pdf", {
        html:       buildPdfHtml(tab.content, tab.fileName),
        outputPath: path,
      });
    } catch (e) {
      error("PDF 내보내기 실패", String(e));
    }
  };

  // ── Table popup ────────────────────────────────────────────────
  const [tablePopupOpen, setTablePopupOpen] = useState(false);
  const [tableAnchorRect, setTableAnchorRect] = useState<DOMRect | null>(null);
  const tableBtnRef = useRef<HTMLButtonElement>(null);

  // ── OS Fullscreen 토글 ──────────────────────────────────────────
  const handleFullscreen = async () => {
    try {
      if (state.osFullscreen) {
        await getCurrentWindow().setFullscreen(false);
        dispatch({ type: "SET_OS_FULLSCREEN", value: false });
        dispatch({ type: "SET_ZEN", value: false });
      } else {
        await getCurrentWindow().setFullscreen(true);
        dispatch({ type: "SET_OS_FULLSCREEN", value: true });
        dispatch({ type: "SET_ZEN", value: true });
      }
    } catch (e) {
      error("전체화면 전환 실패", String(e));
    }
  };

  // ── 이미지 삽입 ────────────────────────────────────────────────
  const insertImage = () => {
    crepeInstance?.editor.action(insert("\n![]()\n"));
  };

  return (
    <div id="toolbar">
      <>
          <Btn onClick={newFile} title="새 파일 (⌘N)"><Icon name="draft" /></Btn>

          {/* 파일/폴더 열기 드롭다운 */}
          <div className="tb-dropdown-wrap" ref={openMenuRef}>
            <Btn
              onClick={() => setOpenMenuVisible(v => !v)}
              title="열기"
              active={openMenuVisible}
            >
              <Icon name="folder_open" />
            </Btn>
            {openMenuVisible && (
              <div className="tb-dropdown">
                <button className="tb-dropdown-item" onClick={handleOpenFile}>
                  <Icon name="file_open" size={16} />
                  <span>파일 열기</span>
                  <span className="tb-dropdown-shortcut">⌘O</span>
                </button>
                <button className="tb-dropdown-item" onClick={handleOpenFolder}>
                  <Icon name="create_new_folder" size={16} />
                  <span>폴더 열기</span>
                </button>
              </div>
            )}
          </div>

          {/* 저장 드롭다운 */}
          <div className="tb-dropdown-wrap" ref={saveMenuRef}>
            <Btn
              onClick={() => setSaveMenuVisible(v => !v)}
              title="저장"
              active={saveMenuVisible}
            >
              <Icon name="save" />
            </Btn>
            {saveMenuVisible && (
              <div className="tb-dropdown">
                <button className="tb-dropdown-item" onClick={() => { setSaveMenuVisible(false); saveFile(); }}>
                  <Icon name="save" size={16} />
                  <span>저장</span>
                  <span className="tb-dropdown-shortcut">⌘S</span>
                </button>
                <button className="tb-dropdown-item" onClick={() => { setSaveMenuVisible(false); saveFileAs(); }}>
                  <Icon name="save_as" size={16} />
                  <span>다른 이름으로 저장</span>
                  <span className="tb-dropdown-shortcut">⌘⇧S</span>
                </button>
              </div>
            )}
          </div>
          <Sep />

          <Btn onClick={() => cmd(undoCommand.key)} title="실행 취소 (⌘Z)" disabled={!state.canUndo}><Icon name="undo" /></Btn>
          <Btn onClick={() => cmd(redoCommand.key)} title="다시 실행 (⌘⇧Z)" disabled={!state.canRedo}><Icon name="redo" /></Btn>
          <Sep />

          <Btn onClick={() => cmd(toggleStrongCommand.key)}        title="굵게 (⌘B)"><Icon name="format_bold" /></Btn>
          <Btn onClick={() => cmd(toggleEmphasisCommand.key)}      title="기울임 (⌘I)"><Icon name="format_italic" /></Btn>
          <Btn onClick={() => cmd(toggleStrikethroughCommand.key)} title="취소선"><Icon name="strikethrough_s" /></Btn>
          <Btn onClick={() => cmd(toggleHighlightCommand.key)}     title="형광펜 (==text==)"><Icon name="ink_highlighter" /></Btn>

          {/* 링크 버튼 + portal 팝업 */}
          <Btn
            ref={linkBtnRef}
            onClick={() => {
              const rect = linkBtnRef.current?.getBoundingClientRect() ?? null;
              setLinkAnchorRect(rect);
              setLinkPopupOpen(v => !v);
            }}
            title="링크 설정 (⌘K)"
            active={linkPopupOpen}
          >
            <Icon name="link" />
          </Btn>
          {linkPopupOpen && linkAnchorRect && (
            <LinkPopup
              anchorRect={linkAnchorRect}
              onClose={() => setLinkPopupOpen(false)}
            />
          )}
          <Sep />

          <Btn onClick={() => cmd(wrapInBulletListCommand.key)}  title="목록"><Icon name="format_list_bulleted" /></Btn>
          <Btn onClick={() => cmd(wrapInOrderedListCommand.key)} title="번호 목록"><Icon name="format_list_numbered" /></Btn>
          <Btn onClick={() => cmd(wrapInBlockquoteCommand.key)}  title="인용문"><Icon name="format_quote" /></Btn>
          <Btn onClick={() => cmd(insertHrCommand.key)}          title="구분선 (---)"><Icon name="horizontal_rule" /></Btn>
          <Sep />

          {/* 표 삽입 버튼 + portal 팝업 */}
          <Btn
            ref={tableBtnRef}
            onClick={() => {
              const rect = tableBtnRef.current?.getBoundingClientRect() ?? null;
              setTableAnchorRect(rect);
              setTablePopupOpen(v => !v);
            }}
            title="표 삽입"
            active={tablePopupOpen}
          >
            <Icon name="table" />
          </Btn>
          {tablePopupOpen && tableAnchorRect && (
            <TablePopup
              anchorRect={tableAnchorRect}
              onClose={() => setTablePopupOpen(false)}
            />
          )}

          {/* 이미지 삽입 */}
          <Btn onClick={insertImage} title="이미지 삽입">
            <Icon name="image" />
          </Btn>
          <Sep />

          <Btn onClick={() => dispatch({ type: "DEC_FONT_SIZE" })} title="글꼴 축소 (⌘-)"><Icon name="zoom_out" /></Btn>
          <Btn onClick={() => dispatch({ type: "INC_FONT_SIZE" })} title="글꼴 확대 (⌘+)"><Icon name="zoom_in" /></Btn>
          <Sep />

          <Btn
            onClick={() => dispatch({ type: "TOGGLE_ZEN" })}
            title="글쓰기 모드 (⌘.)"
            active={state.zenMode}
          >
            <Icon name="chrome_reader_mode" />
          </Btn>
          <Btn
            onClick={handleFullscreen}
            title={state.osFullscreen ? "전체화면 종료 (Esc)" : "전체화면"}
            active={state.osFullscreen}
          >
            <Icon name={state.osFullscreen ? "fullscreen_exit" : "fullscreen"} />
          </Btn>
          <Sep />

          {/* PDF 내보내기 */}
          <Btn onClick={exportPdf} title="PDF로 내보내기">
            <Icon name="ios_share" />
          </Btn>

          <span id="toolbar-filename">
            {tab.isDirty ? "● " : ""}{tab.fileName}
          </span>
      </>
    </div>
  );
}
