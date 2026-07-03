import { useApp, activeTab } from "../../shared/store/appStore";
import type { Encoding } from "../../shared/store/appStore";
import "./StatusBar.css";

const ENCODINGS: Encoding[] = ["UTF-8", "EUC-KR", "CP949"];

function formatBytes(bytes: number): string {
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function StatusBar() {
  const { state, dispatch } = useApp();
  const tab = activeTab(state);

  return (
    <div id="status-bar">
      {/* 저장 상태 */}
      <span className={tab.isDirty ? "dirty" : "saved"}>
        {tab.isDirty ? "● 저장 안 됨" : "저장됨"}
      </span>

      <div className="sb-spacer" />

      {/* 글자 수 */}
      <span className="sb-stat" title="글자 수">
        <span className="sb-label">글자</span>
        {tab.charCount.toLocaleString()}
      </span>

      <span className="sb-divider">·</span>

      {/* 바이트 수 */}
      <span className="sb-stat" title={`${tab.byteCount.toLocaleString()} bytes`}>
        <span className="sb-label">크기</span>
        {formatBytes(tab.byteCount)}
      </span>

      <span className="sb-divider">·</span>

      {/* 단어 수 */}
      <span className="sb-stat" title="단어 수">
        <span className="sb-label">단어</span>
        {tab.wordCount.toLocaleString()}
      </span>

      {/* 인코딩 */}
      <select
        className="sb-encoding"
        value={tab.encoding}
        onChange={(e) => dispatch({ type: "SET_ENCODING", encoding: e.target.value as Encoding })}
        title="인코딩"
      >
        {ENCODINGS.map((enc) => <option key={enc} value={enc}>{enc}</option>)}
      </select>
    </div>
  );
}
