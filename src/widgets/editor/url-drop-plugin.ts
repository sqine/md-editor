/**
 * URL 드래그 앤 드롭 플러그인
 * - 이미지 URL 드롭 → ![](url) 삽입
 * - 일반 URL 드롭 → [url](url) 삽입
 * - plugin-upload(파일 드롭)와 충돌 없이 동작
 */
import { $prose } from "@milkdown/utils";
import { Plugin, PluginKey } from "@milkdown/prose/state";
import { isImageUrl } from "./image-uploader";

const URL_DROP_KEY = new PluginKey("URL_DROP");

export const urlDropPlugin = $prose(() => {
  return new Plugin({
    key: URL_DROP_KEY,
    props: {
      handleDrop(view, event) {
        if (!(event instanceof DragEvent)) return false;

        const dt = event.dataTransfer;
        if (!dt) return false;

        // 파일 드롭은 plugin-upload가 처리하므로 패스
        if (dt.files && dt.files.length > 0) return false;

        // URI list 또는 plain text에서 URL 추출
        const uriList = dt.getData("text/uri-list").trim();
        const plainText = dt.getData("text/plain").trim();
        const raw = uriList || plainText;
        if (!raw) return false;

        // 여러 줄이면 첫 번째 유효한 URL만 사용
        const url = raw
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find((l) => l && !l.startsWith("#"));

        if (!url) return false;

        // URL 형식 검증 (http/https/ftp only)
        let validUrl: string;
        try {
          const parsed = new URL(url);
          if (!["http:", "https:", "ftp:"].includes(parsed.protocol)) return false;
          validUrl = parsed.href;
        } catch {
          return false;
        }

        event.preventDefault();

        // 드롭 위치 계산
        const dropPos = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });
        if (!dropPos) return false;

        // 이미지 URL이면 이미지로, 아니면 링크로 삽입
        const markdown = isImageUrl(validUrl)
          ? `![](${validUrl})`
          : `[${validUrl}](${validUrl})`;

        // milkdown ctx에 접근하기 위해 view의 state에서 ctx를 꺼낼 방법이 없으므로
        // document에서 crepeInstance를 통해 action 실행
        // → view.dom의 dataset에서 ctx를 얻는 것도 불가하므로
        //   이 플러그인 내부에서 직접 insertPos를 사용할 수 없음.
        //   대신 CustomEvent를 dispatch해 Editor.tsx에서 처리
        const domEvent = new CustomEvent("md-url-drop", {
          detail: { markdown, pos: dropPos.pos },
          bubbles: true,
        });
        view.dom.dispatchEvent(domEvent);
        return true;
      },
    },
  });
});
