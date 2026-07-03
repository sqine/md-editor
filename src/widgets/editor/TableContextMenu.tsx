/**
 * 표 우클릭 컨텍스트 메뉴
 * - 표 내 어디서나 우클릭 → 행/열 삭제 + 추가
 * - 여러 행/열 선택 상태: "선택 행 모두 삭제" + "현재 행만 삭제" 분리
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { editorViewCtx } from "@milkdown/kit/core";
import { callCommand } from "@milkdown/utils";
import {
  addRowAfterCommand,
  addRowBeforeCommand,
  addColAfterCommand,
  addColBeforeCommand,
} from "@milkdown/preset-gfm";
import { CellSelection, selectedRect, deleteRow, deleteColumn } from "prosemirror-tables";
import { TextSelection } from "prosemirror-state";
import { crepeInstance } from "./Editor";
import "./TableContextMenu.css";

interface MenuState {
  x: number;
  y: number;
  clickX: number;
  clickY: number;
  multiRowSel: number; // 0: 없음, N>1: N행 선택됨
  multiColSel: number;
}

function Icon({ name }: { name: string }) {
  return (
    <span className="material-symbols-outlined" style={{ fontSize: 15, lineHeight: 1 }}>
      {name}
    </span>
  );
}

/** prosemirror-tables 명령을 직접 실행 */
function runPm(fn: (state: ReturnType<typeof import("prosemirror-state").EditorState.create>, dispatch: any) => boolean) {
  if (!crepeInstance) return;
  const view = crepeInstance.editor.action((ctx) => ctx.get(editorViewCtx));
  fn(view.state as any, view.dispatch.bind(view));
}

export default function TableContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!target.closest(".milkdown-table-block")) {
        setMenu(null);
        return;
      }
      if (!crepeInstance) return;

      let multiRowSel = 0;
      let multiColSel = 0;

      try {
        const view = crepeInstance.editor.action((ctx) => ctx.get(editorViewCtx));
        const { selection } = view.state;
        if (selection instanceof CellSelection) {
          if (selection.isRowSelection()) {
            const rect = selectedRect(view.state as any);
            multiRowSel = rect.bottom - rect.top; // 선택된 행 수
          }
          if (selection.isColSelection()) {
            const rect = selectedRect(view.state as any);
            multiColSel = rect.right - rect.left; // 선택된 열 수
          }
        }
      } catch {
        // editor not ready
      }

      e.preventDefault();
      setMenu({
        x: e.clientX,
        y: e.clientY,
        clickX: e.clientX,
        clickY: e.clientY,
        multiRowSel,
        multiColSel,
      });
    };

    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);

    window.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!menu) return null;

  // --- 삭제 핸들러 ---

  /** 현재 선택(또는 커서 위치)의 행 삭제 */
  const deleteCurrentRow = () => {
    runPm((state, dispatch) => deleteRow(state, dispatch));
    setMenu(null);
  };

  /** 현재 선택(또는 커서 위치)의 열 삭제 */
  const deleteCurrentCol = () => {
    runPm((state, dispatch) => deleteColumn(state, dispatch));
    setMenu(null);
  };

  /** 우클릭 위치의 행만 삭제 (멀티셀렉 상태에서 현재 행만) */
  const deleteClickedRow = () => {
    if (!crepeInstance) return;
    const view = crepeInstance.editor.action((ctx) => ctx.get(editorViewCtx));
    const pos = view.posAtCoords({ left: menu.clickX, top: menu.clickY });
    if (pos) {
      const sel = TextSelection.create(view.state.doc, pos.pos);
      view.dispatch(view.state.tr.setSelection(sel));
      deleteRow(view.state as any, view.dispatch.bind(view));
    }
    setMenu(null);
  };

  /** 우클릭 위치의 열만 삭제 (멀티셀렉 상태에서 현재 열만) */
  const deleteClickedCol = () => {
    if (!crepeInstance) return;
    const view = crepeInstance.editor.action((ctx) => ctx.get(editorViewCtx));
    const pos = view.posAtCoords({ left: menu.clickX, top: menu.clickY });
    if (pos) {
      const sel = TextSelection.create(view.state.doc, pos.pos);
      view.dispatch(view.state.tr.setSelection(sel));
      deleteColumn(view.state as any, view.dispatch.bind(view));
    }
    setMenu(null);
  };

  const run = (commandKey: unknown) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    crepeInstance?.editor.action(callCommand(commandKey as any));
    setMenu(null);
  };

  // 메뉴가 화면 밖으로 나가지 않도록 보정
  const menuW = 200;
  const menuH = 280;
  const x = Math.min(menu.x, window.innerWidth - menuW - 8);
  const y = Math.min(menu.y, window.innerHeight - menuH - 8);

  const hasMultiRow = menu.multiRowSel > 1;
  const hasMultiCol = menu.multiColSel > 1;

  return createPortal(
    <div
      className="table-ctx-menu"
      style={{ left: x, top: y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* ── 행 삭제 ── */}
      {hasMultiRow ? (
        <>
          <button className="table-ctx-item table-ctx-danger" onClick={deleteCurrentRow}>
            <Icon name="remove" />
            <span>선택 행 모두 삭제 ({menu.multiRowSel}행)</span>
          </button>
          <button className="table-ctx-item table-ctx-danger" onClick={deleteClickedRow}>
            <Icon name="table_rows" />
            <span>현재 행만 삭제</span>
          </button>
        </>
      ) : (
        <button className="table-ctx-item table-ctx-danger" onClick={deleteCurrentRow}>
          <Icon name="remove" />
          <span>행 삭제</span>
        </button>
      )}

      {/* ── 열 삭제 ── */}
      {hasMultiCol ? (
        <>
          <button className="table-ctx-item table-ctx-danger" onClick={deleteCurrentCol}>
            <Icon name="remove" />
            <span>선택 열 모두 삭제 ({menu.multiColSel}열)</span>
          </button>
          <button className="table-ctx-item table-ctx-danger" onClick={deleteClickedCol}>
            <Icon name="view_column" />
            <span>현재 열만 삭제</span>
          </button>
        </>
      ) : (
        <button className="table-ctx-item table-ctx-danger" onClick={deleteCurrentCol}>
          <Icon name="remove" />
          <span>열 삭제</span>
        </button>
      )}

      <div className="table-ctx-sep" />

      {/* ── 행 추가 ── */}
      <button className="table-ctx-item" onClick={() => run(addRowBeforeCommand.key)}>
        <Icon name="add" />
        <span>위에 행 추가</span>
      </button>
      <button className="table-ctx-item" onClick={() => run(addRowAfterCommand.key)}>
        <Icon name="add" />
        <span>아래에 행 추가</span>
      </button>

      <div className="table-ctx-sep" />

      {/* ── 열 추가 ── */}
      <button className="table-ctx-item" onClick={() => run(addColBeforeCommand.key)}>
        <Icon name="add" />
        <span>왼쪽에 열 추가</span>
      </button>
      <button className="table-ctx-item" onClick={() => run(addColAfterCommand.key)}>
        <Icon name="add" />
        <span>오른쪽에 열 추가</span>
      </button>
    </div>,
    document.body
  );
}
