import { useState, useRef, useCallback } from "react";
import ReactCrop, { centerCrop, makeAspectCrop, type Crop, type PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { cropImageFile } from "./imageOps";

interface Props {
  src: string;          // 원본 이미지 src
  onDone: (newSrc: string) => void;
  onCancel: () => void;
}

function centerAspectCrop(mediaWidth: number, mediaHeight: number): Crop {
  return centerCrop(
    makeAspectCrop({ unit: "%", width: 90 }, mediaWidth / mediaHeight, mediaWidth, mediaHeight),
    mediaWidth,
    mediaHeight,
  );
}

export default function ImageCropModal({ src, onDone, onCancel }: Props) {
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [saving, setSaving] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
    setCrop(centerAspectCrop(w, h));
  }, []);

  const handleConfirm = async () => {
    if (!completedCrop || completedCrop.width === 0 || completedCrop.height === 0) return;
    setSaving(true);
    try {
      const newSrc = await cropImageFile(src, completedCrop);
      // 브라우저 캐시 무효화: 쿼리스트링 타임스탬프 추가
      onDone(newSrc + "?t=" + Date.now());
    } catch (e) {
      alert("크롭 저장 실패: " + String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="img-tool-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="img-tool-modal">
        <div className="img-tool-modal-header">
          <span>이미지 크롭</span>
          <button className="img-tool-modal-close" onClick={onCancel}>✕</button>
        </div>

        <div className="img-tool-modal-body">
          <ReactCrop
            crop={crop}
            onChange={(c) => setCrop(c)}
            onComplete={(c) => setCompletedCrop(c)}
            minWidth={10}
            minHeight={10}
          >
            <img
              ref={imgRef}
              src={src}
              onLoad={onImageLoad}
              style={{ maxWidth: "70vw", maxHeight: "60vh", display: "block" }}
              alt="크롭 대상"
            />
          </ReactCrop>
        </div>

        <div className="img-tool-modal-footer">
          <button className="img-tool-btn-secondary" onClick={onCancel} disabled={saving}>
            취소
          </button>
          <button
            className="img-tool-btn-primary"
            onClick={handleConfirm}
            disabled={saving || !completedCrop || completedCrop.width === 0}
          >
            {saving ? "저장 중…" : "크롭 적용"}
          </button>
        </div>
      </div>
    </div>
  );
}
