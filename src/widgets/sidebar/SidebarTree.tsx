// ── SidebarTree.tsx ──────────────────────────────────────────────
// 사이드바 파일 트리의 개별 노드 및 인라인 입력 컴포넌트
// Sidebar.tsx에서 분리

export interface Entry {
  name:      string;
  path:      string;
  isDir:     boolean;
  children?: Entry[];
}

export interface Creating {
  parentPath: string;
  type: "file" | "folder";
}

// ── Inline creation input ────────────────────────────────────────
export function InlineInput({
  creating, newName, depth, onChange, onKeyDown, onBlur,
}: {
  creating:  Creating;
  newName:   string;
  depth:     number;
  onChange:  (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onBlur:    () => void;
}) {
  return (
    <div className="tree-row tree-creating" style={{ paddingLeft: `${10 + depth * 14}px` }}>
      <span className="tree-icon">
        {creating.type === "folder" ? "📁" : "📄"}
      </span>
      <input
        className="tree-name-input"
        value={newName}
        autoFocus
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        placeholder={creating.type === "folder" ? "폴더 이름" : "파일 이름.md"}
      />
    </div>
  );
}

// ── Tree node ────────────────────────────────────────────────────
export function TreeNode({
  entry, depth, expanded, active, creating, newName,
  onToggle, onOpen, onContextMenu, onNameChange, onKeyDown, onBlur,
}: {
  entry:    Entry;
  depth:    number;
  expanded: Set<string>;
  active:   string | null;
  creating: Creating | null;
  newName:  string;
  onToggle:      (e: Entry) => void;
  onOpen:        (p: string) => void;
  onContextMenu: (ev: React.MouseEvent, path: string, isDir: boolean) => void;
  onNameChange:  (v: string) => void;
  onKeyDown:     (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onBlur:        () => void;
}) {
  const isMd  = /\.(md|txt|markdown)$/i.test(entry.name);
  const isExp = expanded.has(entry.path);

  return (
    <>
      <div
        className={`tree-row ${!entry.isDir && active === entry.path ? "active" : ""}`}
        style={{ paddingLeft: `${10 + depth * 14}px` }}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (entry.isDir ? onToggle(entry) : isMd && onOpen(entry.path))}
        onContextMenu={(e) => onContextMenu(e, entry.path, entry.isDir)}
        title={entry.name}
      >
        <span className="tree-icon">
          {entry.isDir ? (isExp ? "▾" : "▸") : isMd ? "📄" : "·"}
        </span>
        <span className="tree-name">{entry.name}</span>
      </div>

      {entry.isDir && isExp && (
        <>
          {creating?.parentPath === entry.path && (
            <InlineInput
              creating={creating}
              newName={newName}
              depth={depth + 1}
              onChange={onNameChange}
              onKeyDown={onKeyDown}
              onBlur={onBlur}
            />
          )}
          {entry.children?.map((c) => (
            <TreeNode
              key={c.path}
              entry={c}
              depth={depth + 1}
              expanded={expanded}
              active={active}
              creating={creating}
              newName={newName}
              onToggle={onToggle}
              onOpen={onOpen}
              onContextMenu={onContextMenu}
              onNameChange={onNameChange}
              onKeyDown={onKeyDown}
              onBlur={onBlur}
            />
          ))}
        </>
      )}
    </>
  );
}
