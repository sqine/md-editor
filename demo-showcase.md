# MD Editor — 가볍고, 필요한 건 다 있다.

설치 용량 **5MB 이하**. 그러나 부족한 것 없이.

***

## ✏️ 마크다운 기본기

**굵게**, *기울임*, ~~취소선~~, `인라인 코드` — 전부 실시간으로 렌더링됩니다.\
==형광펜==으로 중요한 부분을 강조할 수도 있습니다.

> 복잡한 설정 없이, 열자마자 바로 씁니다.

***

## 🔢 수식 — KaTeX 내장

 $\nabla \cdot \mathbf{E} = \dfrac{\rho}{\varepsilon_0}$

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$

$$
F(x) = \sum_{n=0}^{\infty} \frac{f^{(n)}(a)}{n!}(x-a)^n
$$

***

## 💻 코드 하이라이트

```python
def fibonacci(n: int) -> int:
    """피보나치 수열 — 재귀 방식"""
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

print(fibonacci(10))  # 55
```

```typescript
// Tauri + React로 만든 네이티브 앱
const exportPdf = async () => {
  const path = await save({ filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (!path) return;
  await invoke("export_pdf", { html: buildPdfHtml(content, title) });
};
```

***

## 📊 표

| 기능         | MD Editor | Notion | Obsidian |
| ---------- | :-------: | :----: | :------: |
| 설치 용량      |  **5MB**  | 300MB+ |  400MB+  |
| 수식 (KaTeX) |     ✅     |    ✅   |     ✅    |
| 형광펜        |     ✅     |    ✅   |     ✅    |
| PDF 내보내기   |     ✅     |  💰 유료 |     ✅    |
| 오프라인       |     ✅     |    ❌   |     ✅    |
| 완전 무료      |     ✅     |   부분   |    부분    |

***

## 📄 PDF 내보내기

수식, 형광펜, 코드 블록, 표 — **그대로 PDF로 저장됩니다.**\
별도 플러그인 없이, 툴바 버튼 하나로.

***

## 🌙 다크 모드

설정에서 라이트 / 다크 전환.\
선택한 테마는 앱을 껐다 켜도 유지됩니다.

***

*MIT License · 오픈소스 · macOS & Windows*
