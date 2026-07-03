/**
 * 마지막 저장 시간을 상대적인 문자열로 반환
 * null → ""
 * < 10초 → "방금 저장"
 * < 60초 → "N초 전 저장"
 * < 60분 → "N분 전 저장"
 * else  → "HH:MM 저장"
 */
export function formatSavedAt(savedAt: number | null): string {
  if (savedAt == null) return "";
  const diff = Date.now() - savedAt;
  if (diff < 10_000) return "방금 저장";
  if (diff < 60_000) return `${Math.floor(diff / 1_000)}초 전 저장`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전 저장`;
  const d = new Date(savedAt);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm} 저장`;
}
