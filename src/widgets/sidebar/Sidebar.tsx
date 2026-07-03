import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { readDir, mkdir, writeTextFile, exists } from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useApp, activeTab } from "../../shared/store/appStore";
import { useFile } from "../../features/file/useFile";
import { useToast } from "../../shared/ui/Toast";
import { Entry, Creating, InlineInput, TreeNode } from "./SidebarTree";
import { formatSavedAt } from "../../shared/utils/timeUtil";
import "./Sidebar.css";

interface CtxMenu {
  x: number;
  y: number;
  path: string;
  isDir: boolean;
}

export default function Sidebar() {
  const { state, dispatch } = useApp();
  const { openFile } = useFile();
  const { error } = useToast();
  const currentFilePath = activeTab(state).filePath;

  const [tree, setTree]             = useState<Entry[]>([]);
  const [expanded, setExpanded]     = useState<Set<string>>(new Set());
  const [recentOpen, setRecentOpen] = useState(true);
  const [folderOpen, setFolderOpen] = useState(false);
  const [ctxMenu, setCtxMenu]       = useState<CtxMenu | null>(null);
  const [creating, setCreating]     = useState<Creating | null>(null);
  const [newName, setNewName]       = useState("");
  const [, setTick]                 = useState(0); // forces re-render for relative time
  const [missingFiles, setMissingFiles] = useState<Set<string>>(new Set());

  // Refresh relative timestamps every 30s
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Refs to avoid stale closures in async handlers
  const creatingRef = useRef<Creating | null>(null);
  const newNameRef  = useRef("");
  useEffect(() => { creatingRef.current = creating; }, [creating]);

  // Close ctx menu on outside click
  useEffect(() => {
    if (!ctxMenu) return;
    const handler = () => setCtxMenu(null);
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [ctxMenu]);

  // ── Tree helpers ─────────────────────────────────────────────────
  const readEntries = useCallback(async (dir: string): Promise<Entry[]> => {
    try {
      const raw = await readDir(dir);
      return raw
        .filter((e) => e.name && !e.name.startsWith("."))
        .map((e) => ({ name: e.name!, path: `${dir}/${e.name}`, isDir: !!e.isDirectory }))
        .sort((a, b) =>
          a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1
        );
    } catch { return []; }
  }, []);

  const expandedRef = useRef(expanded);
  useEffect(() => { expandedRef.current = expanded; }, [expanded]);

  const refreshTree = useCallback(async () => {
    if (!state.sidebarFolder) return;
    const snap = expandedRef.current;
    const loadLevel = async (dir: string): Promise<Entry[]> => {
      const entries = await readEntries(dir);
      for (const e of entries) {
        if (e.isDir && snap.has(e.path)) {
          e.children = await loadLevel(e.path);
        }
      }
      return entries;
    };
    setTree(await loadLevel(state.sidebarFolder));
  }, [state.sidebarFolder, readEntries]);

  useEffect(() => {
    if (state.sidebarFolder) readEntries(state.sidebarFolder).then(setTree);
  }, [state.sidebarFolder, readEntries]);

  const pickFolder = async () => {
    const folder = await open({ directory: true }) as string | null;
    if (folder) {
      dispatch({ type: "SET_SIDEBAR_FOLDER", folder });
      setFolderOpen(true);
    }
  };

  const toggleDir = useCallback(async (entry: Entry) => {
    const next = new Set(expandedRef.current);
    if (next.has(entry.path)) {
      next.delete(entry.path);
    } else {
      if (!entry.children) entry.children = await readEntries(entry.path);
      next.add(entry.path);
    }
    setExpanded(next);
    setTree((prev) => [...prev]);
  }, [readEntries]);

  // ── Inline creation ──────────────────────────────────────────────
  const startCreate = useCallback((parentPath: string, type: "file" | "folder") => {
    setCtxMenu(null);
    setExpanded((prev) => new Set([...prev, parentPath]));
    setCreating({ parentPath, type });
    setNewName("");
    newNameRef.current = "";
  }, []);

  const doCreate = useCallback(async (c: Creating, name: string) => {
    if (!name) return;
    const finalName = c.type === "file" && !name.includes(".") ? `${name}.md` : name;
    const fullPath  = `${c.parentPath}/${finalName}`;
    try {
      if (c.type === "folder") {
        await mkdir(fullPath, { recursive: true });
      } else {
        await writeTextFile(fullPath, "");
        openFile(fullPath);
      }
      await refreshTree();
    } catch (e) {
      error('파일 생성 실패', String(e));
    }
  }, [openFile, refreshTree]);

  const cancelCreate = useCallback(() => {
    creatingRef.current = null;
    setCreating(null);
    setNewName("");
    newNameRef.current = "";
  }, []);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const c    = creatingRef.current;
      const name = newNameRef.current.trim();
      cancelCreate();
      if (c && name) doCreate(c, name);
    }
    if (e.key === "Escape") cancelCreate();
  }, [cancelCreate, doCreate]);

  const handleInputBlur = useCallback(() => cancelCreate(), [cancelCreate]);

  // ── Recent files — 열린 탭 + 닫힌 최근 파일 통합 목록 ───────────
  const openTabs = state.tabs;
  // 현재 열린 탭에 없는 최근 파일만 추가
  const closedRecents = state.recentFiles.filter(
    (p) => !state.tabs.some((t) => t.filePath === p)
  );

  // 사라진 파일 감지: closedRecents 변경 시 존재 여부 일괄 확인
  useEffect(() => {
    if (closedRecents.length === 0) { setMissingFiles(new Set()); return; }
    let cancelled = false;
    Promise.all(
      closedRecents.map(async (p) => {
        try { return (await exists(p)) ? null : p; }
        catch { return null; }  // 권한 오류 등 → 없음으로 단정하지 않음
      })
    ).then((results) => {
      if (cancelled) return;
      setMissingFiles(new Set(results.filter(Boolean) as string[]));
    });
    return () => { cancelled = true; };
  // closedRecents 는 렌더마다 새 배열이므로 join 으로 안정화
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closedRecents.join("|")]);

  return (
    <>
      <aside id="sidebar" className={state.sidebarOpen ? "" : "sidebar-closed"}>
        {/* ── Header ── */}
        <div className="sb-header">
          <button
            className="sb-collapse-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => dispatch({ type: "TOGGLE_SIDEBAR" })}
            title="사이드바 닫기 (⌘\)"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
              left_panel_close
            </span>
          </button>
        </div>

        {/* ── 최근 파일 섹션 ── */}
        <div className="sb-section">
          <button
            className="sb-section-header"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setRecentOpen((v) => !v)}
          >
            <span className="sb-chevron">{recentOpen ? "▾" : "▸"}</span>
            <span>최근 파일</span>
          </button>
          {recentOpen && (
            <div className="sb-section-body">
              {/* 열린 탭 */}
              {openTabs.map((tab) => (
                <div
                  key={tab.id}
                  className={`recent-item recent-item-row ${state.activeTabId === tab.id ? "active" : ""}`}
                  onContextMenu={tab.filePath ? (e) => {
                    e.preventDefault();
                    setCtxMenu({ x: e.clientX, y: e.clientY, path: tab.filePath!, isDir: false });
                  } : undefined}
                >
                  <button
                    className="recent-item-body"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => dispatch({ type: "SWITCH_TAB", id: tab.id })}
                    title={tab.filePath ?? "저장되지 않은 파일"}
                  >
                    <div className="recent-row">
                      <span className="recent-name">{tab.fileName}</span>
                      {tab.isDirty && <span className="recent-dirty" title="저장되지 않음" />}
                    </div>
                    <div className="recent-row">
                      <span className="recent-path">{tab.filePath ?? "저장되지 않음"}</span>
                      {!tab.isDirty && tab.savedAt && (
                        <span className="recent-saved-at">{formatSavedAt(tab.savedAt)}</span>
                      )}
                    </div>
                  </button>
                  <button
                    className="recent-remove-btn"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatch({ type: "CLOSE_TAB", id: tab.id });
                    }}
                    title="탭 닫기"
                  >×</button>
                </div>
              ))}
              {/* 닫힌 최근 파일 — 구분선 없이 바로 이어서 */}
              {closedRecents.map((p) => {
                const isMissing = missingFiles.has(p);
                return (
                <div
                  key={p}
                  className={`recent-item recent-item-row${currentFilePath === p ? " active" : ""}${isMissing ? " missing" : ""}`}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setCtxMenu({ x: e.clientX, y: e.clientY, path: p, isDir: false });
                  }}
                >
                  <button
                    className="recent-item-body"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => openFile(p)}
                    title={isMissing ? `파일을 찾을 수 없음: ${p}` : p}
                  >
                    <span className="recent-name">{p.split(/[\\/]/).pop()}</span>
                    <span className="recent-path">{p}</span>
                  </button>
                  <button
                    className="recent-remove-btn"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={async (e) => {
                      e.stopPropagation();
                      await invoke("remove_recent_file", { path: p }).catch(() => {});
                      dispatch({ type: "REMOVE_RECENT_FILE", path: p });
                    }}
                    title="목록에서 제거"
                  >×</button>
                </div>
                );
              })}
              {openTabs.length === 0 && closedRecents.length === 0 && (
                <div className="sb-empty-small">최근 파일 없음</div>
              )}
            </div>
          )}
        </div>

        {/* ── 폴더 섹션 ── */}
        <div className="sb-section">
          <button
            className="sb-section-header"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setFolderOpen((v) => !v)}
          >
            <span className="sb-chevron">{folderOpen ? "▾" : "▸"}</span>
            <span className="sb-folder-label">
              {state.sidebarFolder ? state.sidebarFolder.split("/").pop() : "폴더"}
            </span>
            {folderOpen && state.sidebarFolder && (
              <>
                <button
                  className="sb-folder-action-btn"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => { e.stopPropagation(); startCreate(state.sidebarFolder!, "file"); }}
                  title="새 파일"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>note_add</span>
                </button>
                <button
                  className="sb-folder-action-btn"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => { e.stopPropagation(); startCreate(state.sidebarFolder!, "folder"); }}
                  title="새 폴더"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>create_new_folder</span>
                </button>
                <button
                  className="sb-folder-btn"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => { e.stopPropagation(); pickFolder(); }}
                  title="다른 폴더 선택"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 15 }}>folder_open</span>
                </button>
              </>
            )}
          </button>

          {folderOpen && (
            <div className="sb-section-body">
              {!state.sidebarFolder ? (
                <div className="sb-empty-small">
                  <button
                    className="sb-open-folder-btn"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={pickFolder}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>folder_open</span>
                    폴더 선택
                  </button>
                </div>
              ) : (
                <div id="file-tree">
                  {creating?.parentPath === state.sidebarFolder && (
                    <InlineInput
                      creating={creating}
                      newName={newName}
                      depth={0}
                      onChange={(v) => { setNewName(v); newNameRef.current = v; }}
                      onKeyDown={handleInputKeyDown}
                      onBlur={handleInputBlur}
                    />
                  )}
                  {tree.map((e) => (
                    <TreeNode
                      key={e.path}
                      entry={e}
                      depth={0}
                      expanded={expanded}
                      active={currentFilePath}
                      creating={creating}
                      newName={newName}
                      onToggle={toggleDir}
                      onOpen={openFile}
                      onContextMenu={(ev, path, isDir) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        setCtxMenu({ x: ev.clientX, y: ev.clientY, path, isDir });
                      }}
                      onNameChange={(v) => { setNewName(v); newNameRef.current = v; }}
                      onKeyDown={handleInputKeyDown}
                      onBlur={handleInputBlur}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* ── 사이드바 닫힌 경우 재오픈 버튼 ── */}
      {!state.sidebarOpen && (
        <button
          id="sidebar-reopen-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => dispatch({ type: "TOGGLE_SIDEBAR" })}
          title="사이드바 열기 (⌘\)"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            left_panel_open
          </span>
        </button>
      )}

      {/* ── Context menu ── */}
      {ctxMenu && (
        <div
          className="ctx-menu"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {ctxMenu.isDir ? (
            <>
              <button className="ctx-item" onClick={() => startCreate(ctxMenu.path, "file")}>
                <span className="material-symbols-outlined ctx-item-icon">note_add</span>
                새 파일
              </button>
              <button className="ctx-item" onClick={() => startCreate(ctxMenu.path, "folder")}>
                <span className="material-symbols-outlined ctx-item-icon">create_new_folder</span>
                새 폴더
              </button>
              <button
                className="ctx-item"
                onClick={() => { revealItemInDir(ctxMenu.path).catch(() => {}); setCtxMenu(null); }}
              >
                <span className="material-symbols-outlined ctx-item-icon">folder_open</span>
                Finder에서 보기
              </button>
            </>
          ) : (
            <>
              <button
                className="ctx-item"
                onClick={() => { openFile(ctxMenu.path); setCtxMenu(null); }}
              >
                <span className="material-symbols-outlined ctx-item-icon">open_in_new</span>
                열기
              </button>
              <button
                className="ctx-item"
                onClick={() => { revealItemInDir(ctxMenu.path).catch(() => {}); setCtxMenu(null); }}
              >
                <span className="material-symbols-outlined ctx-item-icon">folder_open</span>
                Finder에서 보기
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
