import { createContext, useContext } from "react";

// ── 타입 ─────────────────────────────────────────────────────────
export type Theme      = "light" | "dark";
export type Encoding   = "UTF-8" | "EUC-KR" | "CP949";
export type FontFamily = "system" | "serif" | "mono" | "pretendard" | "nanum";

export interface Tab {
  id:        string;
  filePath:  string | null;
  fileName:  string;
  content:   string;
  isDirty:   boolean;
  encoding:  Encoding;
  wordCount: number;
  charCount: number;
  byteCount: number;
  savedAt:   number | null; // Unix ms timestamp of last save
}

export interface AppState {
  // 탭
  tabs:        Tab[];
  activeTabId: string;

  // 글로벌 UI
  recentFiles:     string[];
  theme:           Theme;
  fontSize:        number;
  fontFamily:      FontFamily;
  focusMode:       boolean;
  zenMode:         boolean;
  osFullscreen:    boolean;
  sidebarOpen:     boolean;
  sidebarFolder:   string | null;
  settingsOpen:    boolean;
  closeDialogOpen: boolean;

  // 파일 동작
  defaultEncoding:  Encoding;
  autoReload:       boolean;
  saveOnFocusLoss:  boolean;

  // 에디터 히스토리 상태
  canUndo: boolean;
  canRedo: boolean;
}

// ── 헬퍼 ─────────────────────────────────────────────────────────
let _tabSeq = 0;
export function makeTab(overrides?: Partial<Tab>): Tab {
  return {
    id:        `tab-${Date.now()}-${++_tabSeq}`,
    filePath:  null,
    fileName:  "untitled.md",
    content:   "",
    isDirty:   false,
    encoding:  "UTF-8",
    wordCount: 0,
    charCount: 0,
    byteCount: 0,
    savedAt:   null,
    ...overrides,
  };
}

/** 현재 활성 탭 반환 */
export function activeTab(state: AppState): Tab {
  return state.tabs.find(t => t.id === state.activeTabId) ?? state.tabs[0];
}

function countWords(content: string) {
  const text = content.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
  return {
    wordCount: text.trim() ? text.trim().split(/\s+/).length : 0,
    charCount: content.length,
    byteCount: new TextEncoder().encode(content).length,
  };
}

function updateTab(tabs: Tab[], id: string, patch: Partial<Tab>): Tab[] {
  return tabs.map(t => t.id === id ? { ...t, ...patch } : t);
}

// ── 초기 탭 ──────────────────────────────────────────────────────
const INIT_TAB = makeTab({
  content: "# 제목 텍스트\n\n본문 텍스트입니다. **굵게**, *기울임*, `인라인 코드` 테스트.\n\n## 소제목\n\n- 항목 1\n- 항목 2\n- 항목 3\n",
});

// ── 설정 영속성 (localStorage) ────────────────────────────────────
const SETTINGS_KEY = "md-editor-settings";

type PersistedSettings = {
  theme:           Theme;
  fontSize:        number;
  fontFamily:      FontFamily;
  defaultEncoding: Encoding;
  autoReload:      boolean;
  saveOnFocusLoss: boolean;
  recentFiles:     string[];
  sidebarOpen:     boolean;
  sidebarFolder:   string | null;
};

function loadSettings(): Partial<PersistedSettings> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveSettings(state: AppState): void {
  try {
    const settings: PersistedSettings = {
      theme:           state.theme,
      fontSize:        state.fontSize,
      fontFamily:      state.fontFamily,
      defaultEncoding: state.defaultEncoding,
      autoReload:      state.autoReload,
      saveOnFocusLoss: state.saveOnFocusLoss,
      recentFiles:     state.recentFiles,
      sidebarOpen:     state.sidebarOpen,
      sidebarFolder:   state.sidebarFolder,
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* storage 접근 실패 시 무시 */ }
}

const saved = loadSettings();

export const defaultState: AppState = {
  tabs:        [INIT_TAB],
  activeTabId: INIT_TAB.id,

  recentFiles:     saved.recentFiles     ?? [],
  theme:           saved.theme           ?? "light",
  fontSize:        saved.fontSize        ?? 15,
  fontFamily:      saved.fontFamily      ?? "system",
  focusMode:       false,
  zenMode:         false,
  osFullscreen:    false,
  sidebarOpen:     saved.sidebarOpen     ?? false,
  sidebarFolder:   saved.sidebarFolder   ?? null,
  settingsOpen:    false,
  closeDialogOpen: false,

  defaultEncoding: saved.defaultEncoding ?? "UTF-8",
  autoReload:      saved.autoReload      ?? true,
  saveOnFocusLoss: saved.saveOnFocusLoss ?? false,

  canUndo: false,
  canRedo: false,
};

// ── 액션 ─────────────────────────────────────────────────────────
export type AppAction =
  // 탭 관리
  | { type: "NEW_TAB" }
  | { type: "CLOSE_TAB";    id: string }
  | { type: "SWITCH_TAB";   id: string }
  // 파일 로드 (탭 재사용 로직 포함)
  | { type: "LOAD_FILE";    path: string; name: string; content: string; encoding?: Encoding }
  // 현재 탭 내용 업데이트
  | { type: "SET_CONTENT";  content: string }
  | { type: "SET_DIRTY";    dirty: boolean }
  | { type: "SET_FILE_PATH"; path: string; name: string }
  | { type: "SET_ENCODING"; encoding: Encoding }
  // 글로벌
  | { type: "SET_RECENT_FILES";      files: string[] }
  | { type: "REMOVE_RECENT_FILE";   path: string }
  | { type: "SET_THEME";             theme: Theme }
  | { type: "SET_FONT_SIZE";         size: number }
  | { type: "INC_FONT_SIZE" }
  | { type: "DEC_FONT_SIZE" }
  | { type: "SET_FONT_FAMILY";       fontFamily: FontFamily }
  | { type: "UPDATE_SAVED_AT"; tabId: string; ts: number }
  | { type: "TOGGLE_FOCUS" }
  | { type: "TOGGLE_ZEN" }
  | { type: "SET_ZEN"; value: boolean }
  | { type: "SET_OS_FULLSCREEN"; value: boolean }
  | { type: "TOGGLE_SIDEBAR" }
  | { type: "SET_SIDEBAR_FOLDER";    folder: string | null }
  | { type: "TOGGLE_SETTINGS" }
  | { type: "SET_CLOSE_DIALOG";      open: boolean }
  | { type: "SET_AUTO_RELOAD";       value: boolean }
  | { type: "SET_SAVE_ON_FOCUS_LOSS"; value: boolean }
  | { type: "SET_DEFAULT_ENCODING";  encoding: Encoding }
  | { type: "SET_HISTORY_STATE"; canUndo: boolean; canRedo: boolean }
;

// ── 리듀서 ───────────────────────────────────────────────────────
export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {

    // ─ 탭 ─
    case "NEW_TAB": {
      const tab = makeTab();
      return { ...state, tabs: [...state.tabs, tab], activeTabId: tab.id };
    }

    case "CLOSE_TAB": {
      if (state.tabs.length === 1) {
        // 마지막 탭 → 빈 탭으로 교체
        const tab = makeTab();
        return { ...state, tabs: [tab], activeTabId: tab.id };
      }
      const idx     = state.tabs.findIndex(t => t.id === action.id);
      const newTabs = state.tabs.filter(t => t.id !== action.id);
      const newActiveId = state.activeTabId === action.id
        ? (newTabs[Math.max(0, idx - 1)]?.id ?? newTabs[0].id)
        : state.activeTabId;
      return { ...state, tabs: newTabs, activeTabId: newActiveId };
    }

    case "SWITCH_TAB":
      return { ...state, activeTabId: action.id };

    case "LOAD_FILE": {
      const { path, name, content } = action;
      const enc    = action.encoding ?? state.defaultEncoding;
      const counts = countWords(content);
      const patch: Partial<Tab> = { filePath: path, fileName: name, content, isDirty: false, encoding: enc, ...counts };

      // 이미 열린 탭 → 내용 갱신 후 전환
      const existing = state.tabs.find(t => t.filePath === path);
      if (existing) {
        return { ...state, activeTabId: existing.id, tabs: updateTab(state.tabs, existing.id, patch) };
      }

      // 활성 탭이 빈 untitled → 재사용
      const active = state.tabs.find(t => t.id === state.activeTabId)!;
      if (!active.filePath && !active.isDirty && active.content === "") {
        return { ...state, tabs: updateTab(state.tabs, state.activeTabId, patch) };
      }

      // 새 탭 생성
      const tab = makeTab(patch);
      return { ...state, tabs: [...state.tabs, tab], activeTabId: tab.id };
    }

    case "SET_CONTENT": {
      const counts = countWords(action.content);
      return { ...state, tabs: updateTab(state.tabs, state.activeTabId, { content: action.content, isDirty: true, ...counts }) };
    }

    case "SET_DIRTY":
      return { ...state, tabs: updateTab(state.tabs, state.activeTabId, { isDirty: action.dirty }) };

    case "UPDATE_SAVED_AT":
      return { ...state, tabs: updateTab(state.tabs, action.tabId, { isDirty: false, savedAt: action.ts }) };

    case "SET_FILE_PATH":
      return { ...state, tabs: updateTab(state.tabs, state.activeTabId, { filePath: action.path, fileName: action.name, isDirty: false }) };

    case "SET_ENCODING":
      return { ...state, tabs: updateTab(state.tabs, state.activeTabId, { encoding: action.encoding }) };

    // ─ 글로벌 ─
    case "SET_RECENT_FILES":    return { ...state, recentFiles: action.files };
    case "REMOVE_RECENT_FILE":  return { ...state, recentFiles: state.recentFiles.filter(p => p !== action.path) };
    case "SET_THEME":           return { ...state, theme: action.theme };
    case "SET_FONT_SIZE":       return { ...state, fontSize: Math.min(Math.max(action.size, 10), 32) };
    case "INC_FONT_SIZE":       return { ...state, fontSize: Math.min(state.fontSize + 1, 32) };
    case "DEC_FONT_SIZE":       return { ...state, fontSize: Math.max(state.fontSize - 1, 10) };
    case "SET_FONT_FAMILY":     return { ...state, fontFamily: action.fontFamily };
    case "TOGGLE_FOCUS":        return { ...state, focusMode: !state.focusMode };
    case "TOGGLE_ZEN":          return { ...state, zenMode: !state.zenMode };
    case "SET_ZEN":             return { ...state, zenMode: action.value };
    case "SET_OS_FULLSCREEN":   return { ...state, osFullscreen: action.value };
    case "TOGGLE_SIDEBAR":      return { ...state, sidebarOpen: !state.sidebarOpen };
    case "SET_SIDEBAR_FOLDER":  return { ...state, sidebarFolder: action.folder };
    case "TOGGLE_SETTINGS":     return { ...state, settingsOpen: !state.settingsOpen };
    case "SET_CLOSE_DIALOG":    return { ...state, closeDialogOpen: action.open };
    case "SET_AUTO_RELOAD":     return { ...state, autoReload: action.value };
    case "SET_SAVE_ON_FOCUS_LOSS": return { ...state, saveOnFocusLoss: action.value };
    case "SET_DEFAULT_ENCODING": return { ...state, defaultEncoding: action.encoding };
    case "SET_HISTORY_STATE":   return { ...state, canUndo: action.canUndo, canRedo: action.canRedo };

    default: return state;
  }
}

// ── Context ───────────────────────────────────────────────────────
export const AppContext = createContext<{
  state:    AppState;
  dispatch: React.Dispatch<AppAction>;
} | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
