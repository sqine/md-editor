/**
 * imageOps.ts
 * Canvas API로 이미지 크롭/리사이즈 후 Tauri를 통해 파일에 저장한다.
 */
import { invoke } from "@tauri-apps/api/core";
import type { PixelCrop } from "react-image-crop";

/** src 경로에서 HTMLImageElement를 생성해 반환 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Canvas → PNG Blob */
function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Canvas toBlob failed"));
    }, "image/png");
  });
}

/** Blob → Uint8Array → Tauri write_binary_file */
async function saveBlobToPath(blob: Blob, path: string): Promise<void> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = Array.from(new Uint8Array(arrayBuffer));
  await invoke("write_binary_file", { path, data: bytes });
}

/**
 * 이미지 파일을 크롭하여 동일 경로에 덮어쓴다.
 * @param srcPath  원본 파일 절대경로 (tauri://localhost/... 또는 파일 경로)
 * @param crop     react-image-crop의 PixelCrop
 * @returns        저장된 절대 파일 경로
 */
export async function cropImageFile(
  srcPath: string,
  crop: PixelCrop,
): Promise<string> {
  const img = await loadImage(srcPath);

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(crop.width);
  canvas.height = Math.round(crop.height);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Cannot get 2D context");

  ctx.drawImage(
    img,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height,
  );

  const blob = await canvasToBlob(canvas);
  const filePath = toFilePath(srcPath);
  await saveBlobToPath(blob, filePath);
  return filePath;
}

/**
 * 이미지 파일을 지정 크기로 스케일하여 동일 경로에 덮어쓴다.
 * @param srcPath  원본 파일 절대경로
 * @param width    새 너비 (px)
 * @param height   새 높이 (px)
 * @returns        저장된 절대 파일 경로
 */
export async function resizeImageFile(
  srcPath: string,
  width: number,
  height: number,
): Promise<string> {
  const img = await loadImage(srcPath);

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Cannot get 2D context");

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const blob = await canvasToBlob(canvas);
  const filePath = toFilePath(srcPath);
  await saveBlobToPath(blob, filePath);
  return filePath;
}

/**
 * tauri://localhost/absolute/path → /absolute/path 변환
 * 이미 절대경로면 그대로 반환
 */
function toFilePath(src: string): string {
  if (src.startsWith("tauri://localhost")) {
    return decodeURIComponent(src.replace("tauri://localhost", ""));
  }
  if (src.startsWith("https://asset.localhost")) {
    // asset protocol: https://asset.localhost/path
    const url = new URL(src);
    return decodeURIComponent(url.pathname);
  }
  return src;
}


