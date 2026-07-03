/**
 * Tauri 환경용 이미지 업로더
 * - 저장된 파일: {파일경로}/assets/{timestamp}_{filename} 에 저장 → 상대경로 삽입
 * - 미저장 파일: base64 data URL fallback
 */
import { writeFile, mkdir } from "@tauri-apps/plugin-fs";
import { dirname, join } from "@tauri-apps/api/path";

// Editor 컴포넌트가 업데이트하는 현재 파일 경로
export let currentFilePath: string | null = null;
export function setCurrentFilePath(path: string | null) {
  currentFilePath = path;
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

/** 파일 이름에서 안전한 slug 생성 */
function safeName(name: string): string {
  const ext = name.includes(".") ? name.split(".").pop()! : "png";
  const base = name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9가-힣._-]/g, "_").slice(0, 40);
  return `${Date.now()}_${base}.${ext}`;
}

/**
 * 이미지 파일을 받아 ProseMirror 노드 배열 반환
 * plugin-upload의 uploader 시그니처와 호환
 */
export async function tauriImageUploader(
  files: FileList,
  schema: any,
): Promise<any[]> {
  const imgs: File[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files.item(i);
    if (!file) continue;
    if (!file.type.startsWith("image/")) continue;
    imgs.push(file);
  }
  if (imgs.length === 0) return [];

  const { image } = schema.nodes;
  if (!image) return [];

  return Promise.all(
    imgs.map(async (img): Promise<any> => {
      // 저장된 파일이 있으면 assets/ 폴더에 복사
      if (currentFilePath) {
        try {
          const dir = await dirname(currentFilePath);
          const assetsDir = await join(dir, "assets");
          await mkdir(assetsDir, { recursive: true });

          const fileName = safeName(img.name);
          const destPath = await join(assetsDir, fileName);

          const buf = await readAsArrayBuffer(img);
          await writeFile(destPath, new Uint8Array(buf));

          return image.createAndFill({ src: `./assets/${fileName}`, alt: img.name });
        } catch (err) {
          console.warn("[image-uploader] 파일 저장 실패, base64 fallback:", err);
        }
      }

      // Fallback: base64 data URL
      const src = await readAsDataURL(img);
      return image.createAndFill({ src, alt: img.name });
    })
  );
}

/** URL이 이미지 URL인지 판단 */
export function isImageUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)(\?.*)?$/i.test(pathname);
  } catch {
    return /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)(\?.*)?$/i.test(url);
  }
}
