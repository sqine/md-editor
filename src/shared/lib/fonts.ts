import type { FontFamily } from "../store/appStore";

export function getFontStack(font: FontFamily): string {
  switch (font) {
    case "serif":      return "Georgia, 'Times New Roman', '바탕', serif";
    case "mono":       return "'JetBrains Mono', 'Fira Code', Consolas, monospace";
    case "pretendard": return "'Pretendard', -apple-system, sans-serif";
    case "nanum":      return "'나눔고딕', 'NanumGothic', sans-serif";
    default:           return "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  }
}
