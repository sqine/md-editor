import { marked, Renderer } from "marked";
import hljs from "highlight.js";
import katex from "katex";
import _katexCssRaw  from "katex/dist/katex.min.css?inline";
import _hljsCssRaw   from "highlight.js/styles/github-dark.min.css?inline";

// KaTeX @font-face는 file:// 상대 경로가 깨지므로 제거 → 시스템 serif 폴백
const katexCss = _katexCssRaw.replace(/@font-face\s*\{[^}]*\}/g, "");
const hljsCss  = _hljsCssRaw;

// ── marked: 코드 블록에 highlight.js 적용 ────────────────────────────────────
const renderer = new Renderer();
renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
  const language = lang && hljs.getLanguage(lang) ? lang : "plaintext";
  const highlighted = hljs.highlight(text, { language, ignoreIllegals: true }).value;
  return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`;
};
marked.use({ renderer });

// ── 두 단계 stash로 수식 렌더링 ──────────────────────────────────────────────
//
// codeStash  : 코드 블록을 보호 → marked 직전 복원 (marked가 코드 펜스 파싱)
// mathStash  : KaTeX HTML 저장 → marked 직후 복원
//              (KaTeX 출력에 '|'가 포함되면 테이블 파서가 오인하므로 후복원)
function renderMarkdownWithMath(md: string): string {
  const codeStash: string[] = [];
  const mathStash: string[] = [];

  // 1. 코드 블록 보호
  let result = md
    .replace(/```[\s\S]*?```/g, (m) => {
      codeStash.push(m);
      return `\x00CODE${codeStash.length - 1}\x00`;
    })
    .replace(/`[^`\n]+`/g, (m) => {
      codeStash.push(m);
      return `\x00CODE${codeStash.length - 1}\x00`;
    });

  // 2. $$...$$ → KaTeX 블록 수식
  result = result.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
    try {
      mathStash.push(katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false }));
    } catch {
      mathStash.push(`<div class="katex-error">$$${tex}$$</div>`);
    }
    return `\x00MATH${mathStash.length - 1}\x00`;
  });

  // 3. $...$ → KaTeX 인라인 수식
  result = result.replace(/\$([^\n$]+?)\$/g, (_, tex) => {
    try {
      mathStash.push(katex.renderToString(tex.trim(), { displayMode: false, throwOnError: false }));
    } catch {
      mathStash.push(`<span class="katex-error">$${tex}$</span>`);
    }
    return `\x00MATH${mathStash.length - 1}\x00`;
  });

  // 4a. ==text== → <mark> (코드/수식 stash 후이므로 안전)
  result = result.replace(/==([^=\n]+)==/g, "<mark>$1</mark>");

  // 4b. 코드 블록 복원 → marked가 <pre><code>로 변환
  result = result.replace(/\x00CODE(\d+)\x00/g, (_, i) => codeStash[Number(i)]);

  // 5. marked: 마크다운 → HTML
  result = marked.parse(result) as string;

  // 6. KaTeX HTML 복원
  result = result.replace(/\x00MATH(\d+)\x00/g, (_, i) => mathStash[Number(i)]);

  return result;
}

// ── PDF 내보내기 ─────────────────────────────────────────────────────────────
export function buildPdfHtml(markdown: string, title: string): string {
  const content   = renderMarkdownWithMath(markdown);
  const safeTitle = title.replace(/</g, "&lt;").replace(/\.md$/i, "");

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${safeTitle}</title>

<!-- KaTeX -->
<style>${katexCss}</style>
<!-- highlight.js github-dark -->
<style>${hljsCss}</style>

<style>
@page { size: A4; margin: 0; }

html, body {
  margin: 0;
  padding: 0;
  background: #fff;
  color: #111827;
  font-family: -apple-system, "Segoe UI", "Noto Sans KR", "Apple SD Gothic Neo", sans-serif;
  font-size: 10.5pt;
  line-height: 1.75;
}
body {
  padding: 20mm 18mm;
  box-sizing: border-box;
}

/* 제목 */
h1, h2, h3, h4, h5, h6 {
  font-weight: 600;
  line-height: 1.3;
  margin: 1.4em 0 0.5em;
  page-break-after: avoid;
  color: #0f172a;
}
h1 { font-size: 2em;    border-bottom: 2px solid #e5e7eb; padding-bottom: 0.2em; }
h2 { font-size: 1.5em;  border-bottom: 1px solid #e5e7eb; padding-bottom: 0.15em; }
h3 { font-size: 1.25em; }
h4 { font-size: 1.1em;  }

p { margin: 0.8em 0; }

/* 링크 */
a {
  color: #2563eb;
  text-decoration: none;
  border-bottom: 1px solid #93c5fd;
}
a:hover { border-bottom-color: #2563eb; }

strong { font-weight: 700; }
em     { font-style: italic; }

/* 인라인 코드 */
code {
  background: #f1f5f9;
  color: #be185d;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid #e2e8f0;
  font-family: "SFMono-Regular", "Consolas", "Menlo", monospace;
  font-size: 0.85em;
  font-weight: 500;
}

/* 코드 블록 */
pre {
  margin: 1em 0;
  border-radius: 8px;
  overflow-x: auto;
  page-break-inside: avoid;
}
pre code {
  /* hljs가 배경·색상·패딩을 처리하므로 인라인 코드 스타일 리셋 */
  background: none;
  color: inherit;
  padding: 0;
  border: none;
  border-radius: 0;
  font-size: 0.9em;
  font-weight: normal;
}

/* 인용문 */
blockquote {
  border-left: 4px solid #2563eb;
  background: #eff6ff;
  margin: 1em 0;
  padding: 10px 20px;
  color: #374151;
  border-radius: 0 6px 6px 0;
}
blockquote p { margin: 0.3em 0; }

/* 목록 */
ul, ol {
  margin: 0.6em 0;
  padding-left: 1.8em;
}
li { margin: 0.3em 0; }
li > ul, li > ol { margin: 0.2em 0; }

/* 수평선 */
hr {
  border: none;
  border-top: 1px solid #e5e7eb;
  margin: 1.5em 0;
}

/* 테이블 */
table {
  border-collapse: collapse;
  width: 100%;
  margin: 1em 0;
  table-layout: fixed;
  page-break-inside: avoid;
  font-size: 0.95em;
}
th, td {
  border: 1px solid #d1d5db;
  padding: 8px 12px;
  text-align: left;
  word-break: break-word;
}
th {
  background: #f8fafc;
  font-weight: 600;
  color: #0f172a;
}
tr:nth-child(even) td { background: #f8fafc; }

/* 이미지 */
img { max-width: 100%; border-radius: 6px; }

/* KaTeX 블록 수식 */
.katex-display {
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 1em 1.5em;
  margin: 1em 0;
  overflow-x: auto;
  text-align: center;
}
.katex-display > .katex {
  background: none !important;
  padding: 0 !important;
}

/* KaTeX 인라인 수식 */
.katex:not(.katex-display .katex) {
  background: #e8edf3;
  border-radius: 4px;
  padding: 1px 5px;
}

/* 형광펜 */
mark {
  background: #fef08a;
  color: inherit;
  padding: 1px 2px;
  border-radius: 2px;
}

/* 수식 오류 */
.katex-error { color: #dc2626; font-family: monospace; font-size: 0.9em; }
</style>
</head>
<body>
${content}
</body>
</html>`;
}

