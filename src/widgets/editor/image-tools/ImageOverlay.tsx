import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { resizeImageFile } from "./imageOps";
import ImageCropModal from "./ImageCropModal";
import "./image-tools.css";

interface SelectedImage {
  src: string;          // 원본 src (파일 경로)
  rect: DOMRect;        // 이미지 DOM 위치
  naturalW: number;
  naturalH: number;
  imgEl: HTMLImageElement;  // 선택된 img 엘리먼트 — 스크롤/리사이즈 시 위치 추적용
  onSrcChange: (newSrc: string) => void;
}

interface Props {
  containerEl: HTMLElement;               // .milkdown 컨테이너
  onSrcChange: (nodePos: number, newSrc: string) => void;
  getPosFromEl: (el: HTMLElement) => number | null;
}

// 리사이즈 핸들 방향
type Handle = "nw" | "ne" | "sw" | "se";
const HANDLES: Handle[] = ["nw", "ne", "sw", "se"];

export default function ImageOverlay({ containerEl, onSrcChange, getPosFromEl }: Props) {
  const [selected, setSelected] = useState<SelectedImage | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [previewRect, setPreviewRect] = useState<DOMRect | null>(null);

  const resizeStart = useRef<{
    handle: Handle; startX: number; startY: number;
    origW: number; origH: number; origRect: DOMRect;
  } | null>(null);

  // ── 이미지 클릭 감지 ─────────────────────────────────────────
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const imgEl = target.closest(".milkdown-image-block img") as HTMLImageElement | null;
      if (!imgEl) {
        // 오버레이 자체 클릭은 무시, 그 외 클릭으로 선택 해제
        if (!(target as HTMLElement).closest(".img-tool-overlay")) {
          setSelected(null);
          setCropOpen(false);
        }
        return;
      }

      const blockEl = imgEl.closest(".milkdown-image-block") as HTMLElement;
      if (!blockEl) return;

      const pos = getPosFromEl(blockEl);
      if (pos === null) return;

      setSelected({
        src: imgEl.src,
        rect: imgEl.getBoundingClientRect(),
        naturalW: imgEl.naturalWidth,
        naturalH: imgEl.naturalHeight,
        imgEl,
        onSrcChange: (newSrc) => onSrcChange(pos, newSrc),
      });
    };

    containerEl.addEventListener("click", onClick, true);
    return () => containerEl.removeEventListener("click", onClick, true);
  }, [containerEl, getPosFromEl, onSrcChange]);

  // ── 스크롤/리사이즈 시 위치 업데이트 ────────────────────────
  // selected.imgEl ref를 직접 사용해 선택된 이미지만 정확히 추적
  useEffect(() => {
    if (!selected) return;
    const update = () => {
      const { imgEl } = selected;
      // DOM에서 분리된 경우(재렌더 등) 선택 해제
      if (!imgEl.isConnected) { setSelected(null); return; }
      setSelected(prev => prev ? { ...prev, rect: imgEl.getBoundingClientRect() } : null);
    };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [selected]);

  // ── 리사이즈 핸들 드래그 ──────────────────────────────────────
  const onHandlePointerDown = useCallback((e: React.PointerEvent, handle: Handle) => {
    if (!selected) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setResizing(true);
    setPreviewRect(selected.rect);
    resizeStart.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      origW: selected.rect.width,
      origH: selected.rect.height,
      origRect: selected.rect,
    };
  }, [selected]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!resizing || !resizeStart.current || !selected) return;
    const { handle, startX, origW, origH, origRect } = resizeStart.current;
    const dx = e.clientX - startX;
    // dy는 비율 유지로 height 자동 계산하므로 사용하지 않음

    let newW = origW;
    let newH = origH;
    let newLeft = origRect.left;
    let newTop  = origRect.top;
    const ratio = origH / origW;

    switch (handle) {
      case "se": newW = Math.max(50, origW + dx); newH = newW * ratio; break;
      case "sw": newW = Math.max(50, origW - dx); newH = newW * ratio; newLeft = origRect.right - newW; break;
      case "ne": newW = Math.max(50, origW + dx); newH = newW * ratio; newTop = origRect.bottom - newH; break;
      case "nw": newW = Math.max(50, origW - dx); newH = newW * ratio; newLeft = origRect.right - newW; newTop = origRect.bottom - newH; break;
    }

    setPreviewRect(new DOMRect(newLeft, newTop, newW, newH));
  }, [resizing, selected]);

  const onPointerUp = useCallback(async (_e: React.PointerEvent) => {
    if (!resizing || !previewRect || !selected || !resizeStart.current) return;
    setResizing(false);

    const { naturalW, naturalH } = selected;
    const scaleRatio = previewRect.width / selected.rect.width;
    const newW = Math.round(naturalW * scaleRatio);
    const newH = Math.round(naturalH * scaleRatio);

    if (Math.abs(scaleRatio - 1) < 0.02) {
      // 2% 미만 변화는 무시
      setPreviewRect(null);
      resizeStart.current = null;
      return;
    }

    try {
      const newSrc = await resizeImageFile(selected.src, newW, newH);
      const cacheBusted = newSrc + "?t=" + Date.now();
      selected.onSrcChange(cacheBusted);
      setSelected(prev => prev ? { ...prev, src: cacheBusted } : null);
    } catch (err) {
      alert("리사이즈 저장 실패: " + String(err));
    }
    setPreviewRect(null);
    resizeStart.current = null;
  }, [resizing, previewRect, selected]);

  // ── 크롭 완료 ────────────────────────────────────────────────
  const handleCropDone = (newSrc: string) => {
    if (!selected) return;
    selected.onSrcChange(newSrc);
    setSelected(prev => prev ? { ...prev, src: newSrc } : null);
    setCropOpen(false);
  };

  if (!selected) return null;

  const rect = previewRect ?? selected.rect;
  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    left:   rect.left,
    top:    rect.top,
    width:  rect.width,
    height: rect.height,
    pointerEvents: resizing ? "auto" : "none",
    zIndex: 1000,
  };

  const overlay = (
    <div
      className="img-tool-overlay"
      style={overlayStyle}
      onPointerMove={resizing ? onPointerMove : undefined}
      onPointerUp={resizing ? onPointerUp : undefined}
    >
      {/* 선택 테두리 */}
      <div className={`img-tool-border ${resizing ? "img-tool-border--resizing" : ""}`} />

      {/* 코너 리사이즈 핸들 */}
      {HANDLES.map((h) => (
        <div
          key={h}
          className={`img-tool-handle img-tool-handle--${h}`}
          style={{ pointerEvents: "auto" }}
          onPointerDown={(e) => onHandlePointerDown(e, h)}
        />
      ))}

      {/* 리사이즈 미리보기 반투명 오버레이 */}
      {resizing && previewRect && (
        <div className="img-tool-resize-preview" />
      )}

      {/* 액션 버튼 — 리사이즈 중엔 숨김 */}
      {!resizing && (
        <div className="img-tool-actions" style={{ pointerEvents: "auto" }}>
          <button className="img-tool-action-btn" onClick={() => setCropOpen(true)} title="크롭">
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>crop</span>
            크롭
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      {createPortal(overlay, document.body)}
      {cropOpen && (
        createPortal(
          <ImageCropModal
            src={selected.src}
            onDone={handleCropDone}
            onCancel={() => setCropOpen(false)}
          />,
          document.body,
        )
      )}
    </>
  );
}
