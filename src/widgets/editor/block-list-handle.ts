/**
 * block-list-handle.ts  (v3 — 전체 블록 핸들)
 *
 * top-level 블록 + list_item 모두에 드래그 핸들을 표시.
 *   • 평소: opacity 0 (invisible)
 *   • 호버: opacity 0.7 (visible, transition 0.1s)
 *   • 핸들 클래스 .milkdown-block-handle → block-drag.ts가 pointerdown 감지
 *
 * ── DOM 배치 전략 ────────────────────────────────────────────────
 * 핸들을 document.body가 아닌 containerEl(.milkdown) 안에 마운트한다.
 *   • position:fixed 는 부모 관계 없이 viewport 기준으로 배치되므로
 *     .milkdown 안에 두어도 시각적 위치는 동일
 *   • .milkdown의 자식이므로 마우스가 핸들 위로 이동해도
 *     mouseleave가 발생하지 않아 핸들이 사라지지 않음 ✓
 *   • overflow:auto인 .milkdown이 position:fixed 자식을 clip하지 않음 ✓
 *
 * bullet_list / ordered_list 자체에는 핸들 미표시 (li 단위로 처리).
 */

export function setupBlockHandles(
  containerEl: HTMLElement,
  isPendingOrDragging: () => boolean,
): () => void {
  let handleEl:  HTMLElement | null = null;
  let handleFor: HTMLElement | null = null;

  /** .ProseMirror 기준 핸들 left 위치 (gutter 영역) */
  const getHandleLeft = (): number => {
    const proseEl = containerEl.querySelector(".ProseMirror") as HTMLElement | null;
    if (proseEl) {
      const r = proseEl.getBoundingClientRect();
      const p = parseFloat(window.getComputedStyle(proseEl).paddingLeft) || 48;
      return r.left + p - 48;
    }
    return 0;
  };

  const positionHandle = () => {
    if (!handleEl || !handleFor) return;
    const r = handleFor.getBoundingClientRect();
    handleEl.style.left   = `${getHandleLeft()}px`;
    handleEl.style.top    = `${r.top}px`;
    handleEl.style.height = `${r.height}px`;
  };

  const hideHandle = () => {
    handleEl?.remove();
    handleEl  = null;
    handleFor = null;
  };

  const showHandle = (block: HTMLElement) => {
    if (isPendingOrDragging()) { hideHandle(); return; }
    if (block === handleFor && handleEl) { positionHandle(); return; }
    hideHandle();
    handleFor = block;

    const h = document.createElement("div");
    h.className = "md-drag-handle";  // Milkdown 내장 .milkdown-block-handle과 구분
    h.innerHTML = `<span class="material-symbols-outlined" style="font-size:14px;pointer-events:none;user-select:none">drag_indicator</span>`;

    const r = block.getBoundingClientRect();
    Object.assign(h.style, {
      position:       "fixed",     // viewport 기준 배치 (부모 overflow에 무관)
      left:           `${getHandleLeft()}px`,
      top:            `${r.top}px`,
      width:          "24px",
      height:         `${r.height}px`,
      display:        "flex",
      alignItems:     "center",
      justifyContent: "center",
      cursor:         "grab",
      zIndex:         "202",
      opacity:        "0",
      transition:     "opacity 0.1s",
      pointerEvents:  "all",
      color:          "var(--text-muted, #999)",
      boxSizing:      "border-box",
    });

    // document.body가 아닌 containerEl 안에 마운트
    // → 핸들이 .milkdown의 자식 → mouseleave 버그 없음
    containerEl.appendChild(h);
    handleEl = h;
    requestAnimationFrame(() => { if (h.isConnected) h.style.opacity = "0.7"; });
  };

  /**
   * 마우스 위치에서 핸들을 붙일 블록 엘리먼트를 찾는다.
   *   1. li (list_item) — 가장 구체적이므로 우선
   *   2. .ProseMirror 직계 자식 — ul/ol 제외
   */
  const getBlockFromTarget = (target: Element): HTMLElement | null => {
    // 핸들 자체는 제외
    if (target.closest(".md-drag-handle")) return null;

    // 1. list_item
    const li = target.closest("li") as HTMLElement | null;
    if (li && containerEl.contains(li)) return li;

    // 2. top-level block
    const proseEl = containerEl.querySelector(".ProseMirror");
    if (!proseEl) return null;

    let el: Element | null = target;
    while (el && el.parentElement !== proseEl) {
      el = el.parentElement;
      if (!el || !containerEl.contains(el)) return null;
    }
    if (!el || el === proseEl) return null;
    if (el.tagName === "UL" || el.tagName === "OL") return null;

    return el as HTMLElement;
  };

  const onMouseMove = (e: MouseEvent) => {
    if (isPendingOrDragging()) { hideHandle(); return; }
    const block = getBlockFromTarget(e.target as Element);
    if (block) showHandle(block);
    else if (!handleEl?.contains(e.target as Node)) hideHandle();
  };

  const onScroll = () => positionHandle();

  const proseEl = containerEl.querySelector(".ProseMirror") as HTMLElement | null;
  const resizeObs = new ResizeObserver(positionHandle);
  if (proseEl) resizeObs.observe(proseEl);

  containerEl.addEventListener("mousemove",  onMouseMove);
  containerEl.addEventListener("mouseleave", hideHandle);
  window.addEventListener("scroll", onScroll, true);

  return () => {
    resizeObs.disconnect();
    containerEl.removeEventListener("mousemove",  onMouseMove);
    containerEl.removeEventListener("mouseleave", hideHandle);
    window.removeEventListener("scroll", onScroll, true);
    hideHandle();
  };
}
