import { useRef, useState, useEffect } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useApp } from "../../shared/store/appStore";
import type { Tab } from "../../shared/store/appStore";
import "./TabBar.css";

interface TabCtxMenu { x: number; y: number; path: string }

function Icon({ name }: { name: string }) {
  return (
    <span className="material-symbols-outlined" style={{ fontSize: 16, lineHeight: 1, userSelect: "none" }}>
      {name}
    </span>
  );
}

export default function TabBar() {
  const { state, dispatch } = useApp();
  const scrollRef    = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(state.tabs.length);
  const [isOverflow, setIsOverflow] = useState(false);
  const [tabCtxMenu, setTabCtxMenu] = useState<TabCtxMenu | null>(null);

  // 오버플로우 감지
  const checkOverflow = () => {
    const el = scrollRef.current;
    if (!el) return;
    setIsOverflow(el.scrollWidth > el.clientWidth + 1);
  };

  useEffect(() => {
    checkOverflow();
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(checkOverflow);
    ro.observe(el);
    return () => ro.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    checkOverflow();
    if (state.tabs.length > prevCountRef.current && scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
    prevCountRef.current = state.tabs.length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tabs.length]);

  // 컨텍스트 메뉴 외부 클릭 시 닫기
  useEffect(() => {
    if (!tabCtxMenu) return;
    const handler = () => setTabCtxMenu(null);
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [tabCtxMenu]);

  const handleWheel = (e: React.WheelEvent) => {
    if (scrollRef.current) scrollRef.current.scrollLeft += e.deltaY;
  };

  const switchTab = (id: string) => dispatch({ type: "SWITCH_TAB", id });

  const closeTab = (e: React.MouseEvent, tab: Tab) => {
    e.stopPropagation();
    if (tab.isDirty) {
      if (!confirm(`"${tab.fileName}"의 변경 사항을 저장하지 않고 닫으시겠습니까?`)) return;
    }
    dispatch({ type: "CLOSE_TAB", id: tab.id });
  };

  const handleTabContextMenu = (e: React.MouseEvent, tab: Tab) => {
    if (!tab.filePath) return;
    e.preventDefault();
    e.stopPropagation();
    setTabCtxMenu({ x: e.clientX, y: e.clientY, path: tab.filePath });
  };

  const revealInFinder = async (path: string) => {
    setTabCtxMenu(null);
    await revealItemInDir(path).catch(() => {});
  };

  const newTab = () => dispatch({ type: "NEW_TAB" });

  return (
    <>
      <div id="tab-bar">
        {/* 사이드바 토글 */}
        <button
          id="tab-sidebar-btn"
          onClick={() => dispatch({ type: "TOGGLE_SIDEBAR" })}
          title={state.sidebarOpen ? "사이드바 닫기 (⌘\\)" : "사이드바 열기 (⌘\\)"}
        >
          <Icon name={state.sidebarOpen ? "left_panel_close" : "left_panel_open"} />
        </button>

        <div ref={scrollRef} id="tab-bar-scroll" onWheel={handleWheel}>
          {state.tabs.map((tab) => (
            <div
              key={tab.id}
              className={`tab ${tab.id === state.activeTabId ? "tab-active" : ""}`}
              onClick={() => switchTab(tab.id)}
              onContextMenu={(e) => handleTabContextMenu(e, tab)}
              title={tab.filePath ?? tab.fileName}
            >
              {tab.isDirty && <span className="tab-dirty">●</span>}
              <span className="tab-name">{tab.fileName}</span>
              <button className="tab-close" onClick={(e) => closeTab(e, tab)} title="닫기">×</button>
            </div>
          ))}

          {!isOverflow && (
            <button className="tab-new-inline" onClick={newTab} title="새 탭 (⌘N)">+</button>
          )}
        </div>

        {isOverflow && (
          <button id="tab-new-btn" onClick={newTab} title="새 탭 (⌘N)">+</button>
        )}
      </div>

      {/* 탭 컨텍스트 메뉴 */}
      {tabCtxMenu && (
        <div
          className="tab-ctx-menu"
          style={{ top: tabCtxMenu.y, left: tabCtxMenu.x }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button className="tab-ctx-item" onClick={() => revealInFinder(tabCtxMenu.path)}>
            <span className="material-symbols-outlined tab-ctx-item-icon">folder_open</span>
            Finder에서 보기
          </button>
        </div>
      )}
    </>
  );
}
