/**
 * paste-normalize.ts
 *
 * 외부 소스(웹 페이지, Word, Notion, Google Docs 등)에서 붙여넣기 시
 * inline style 기반 마크업을 시맨틱 태그로 정규화한다.
 *
 * ProseMirror의 DOMParser는 시맨틱 태그(strong, em, del)로 정의된
 * parseDOM 규칙만 가지고 있어 span[style]은 인식하지 못한다.
 * 이 변환을 transformPastedHTML 단계에서 수행하면 preProcessedSlice에
 * 서식이 정확히 반영된다.
 */

/**
 * 하나의 Element를 재귀 탐색하며 inline style → 시맨틱 태그로 교체한다.
 * data-pm-slice 속성은 ProseMirror가 필요로 하므로 건드리지 않는다.
 */
function normalizeElement(el: Element): void {
  // 자식을 먼저 정규화 (bottom-up)
  const children = Array.from(el.childNodes);
  for (const child of children) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      normalizeElement(child as Element);
    }
  }

  // <span> 의 인라인 스타일만 처리
  if (el.tagName !== "SPAN") return;

  const span = el as HTMLSpanElement;
  const style = span.style;

  // font-weight → bold?
  const fw = style.fontWeight;
  const isBold =
    fw === "bold" ||
    fw === "bolder" ||
    (fw !== "" && !isNaN(Number(fw)) && Number(fw) >= 700);

  // font-style → italic?
  const isItalic = style.fontStyle === "italic";

  // text-decoration → line-through?
  const isStrike = style.textDecoration.includes("line-through");

  // 아무 스타일도 없으면 건너뜀
  if (!isBold && !isItalic && !isStrike) return;

  // span 내용을 DocumentFragment로 꺼낸 뒤 래퍼 태그로 감싼다
  const frag = document.createDocumentFragment();
  while (span.firstChild) frag.appendChild(span.firstChild);

  // 적용 순서: strike > italic > bold (안쪽부터 바깥으로)
  let wrapped: Node = frag;

  if (isStrike) {
    const del = document.createElement("del");
    del.appendChild(wrapped);
    wrapped = del;
  }
  if (isItalic) {
    const em = document.createElement("em");
    em.appendChild(wrapped);
    wrapped = em;
  }
  if (isBold) {
    const strong = document.createElement("strong");
    strong.appendChild(wrapped);
    wrapped = strong;
  }

  span.parentNode?.replaceChild(wrapped, span);
}

/**
 * HTML 문자열을 받아 외부 소스 호환 정규화를 적용한다.
 *
 * - MS Word/Outlook namespace 태그 제거 (o:, w:, m:)
 * - span[style] → strong / em / del 변환
 */
export function normalizeExternalHtml(html: string): string {
  // 1. MS Office XML 네임스페이스 태그 제거
  html = html.replace(/<\/?[owm]:[^>]*>/gi, "");

  // 2. DOM 조작으로 span 스타일 → 시맨틱 태그
  const div = document.createElement("div");
  div.innerHTML = html;
  normalizeElement(div);
  return div.innerHTML;
}
