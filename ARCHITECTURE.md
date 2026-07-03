# MD-Editor 아키텍처 개요

> 마지막 업데이트: 2026-06-21  
> 스택: Tauri v2 · React 18 · TypeScript · Milkdown/Crepe v7 · ProseMirror · Rust

---

## 1. 디렉터리 구조 (Feature-Sliced Design)

```
src/
├── app/                    ← 최상위 Provider + 전역 단축키 + 레이아웃
│   ├── App.tsx
│   └── styles/global.css
├── features/               ← 도메인 로직 훅 (UI 없음)
│   ├── file/
│   │   ├── useFile.ts          파일 열기/저장/드래그앤드롭
│   │   ├── useAutoDraft.ts     60초 자동 초안 저장
│   │   └── useCloseHandler.ts  앱 종료 요청 가로채기
│   ├── export/
│   │   └── exportHtml.ts       HTML 내보내기
│   └── menu/
│       └── useMenu.ts          네이티브 메뉴 이벤트 바인딩
├── shared/                 ← 프로젝트 전역 공통 모듈
│   ├── store/appStore.ts       단일 전역 상태 (useReducer + Context)
│   ├── ui/Toast.tsx            에러/알림 토스트 시스템
│   ├── lib/fonts.ts            폰트 스택 맵
│   └── utils/timeUtil.ts       시간 포매터
└── widgets/                ← UI 단위 (각각 독립 CSS 보유)
    ├── editor/
    │   ├── Editor.tsx              Crepe 초기화 + 플러그인 연결
    │   ├── Editor.css              에디터 전체 스타일
    │   ├── block-drag.ts           블록 드래그 앤 드롭 + 핸들 선택
    │   ├── block-drag-model.ts     FlatBlock 타입 + 문서 순회 유틸
    │   ├── block-list-handle.ts    list_item 커스텀 핸들 DOM
    │   ├── block-selection-plugin.ts ProseMirror 텍스트→블록 스냅
    │   ├── highlight-plugin.ts     형광펜(==text==) 마크
    │   ├── paste-normalize.ts      외부 붙여넣기 span→시맨틱 변환
    │   ├── image-uploader.ts       Tauri 이미지 파일 저장
    │   ├── url-drop-plugin.ts      URL 드롭 → 마크다운 삽입
    │   ├── TableContextMenu.tsx    표 우클릭 컨텍스트 메뉴
    │   └── image-tools/
    │       ├── ImageOverlay.tsx    이미지 선택/리사이즈 오버레이
    │       ├── ImageCropModal.tsx  이미지 크롭 모달 (react-image-crop)
    │       ├── imageOps.ts         Canvas 크롭/리사이즈 + Tauri 저장
    │       ├── image-tools.css     이미지 툴 전용 스타일
    │       └── index.ts
    ├── toolbar/            Toolbar.tsx + ExportPopup.tsx
    ├── sidebar/            Sidebar.tsx + SidebarTree.tsx
    ├── tab-bar/            TabBar.tsx
    ├── status-bar/         StatusBar.tsx
    ├── settings/           Settings.tsx
    └── close-dialog/       CloseDialog.tsx

src-tauri/src/lib.rs        ← Rust 백엔드 (단일 파일)
```

---

## 2. 상태 관리

```
shared/store/appStore.ts
│
├── AppState          탭 목록, 활성탭, 테마, 폰트, UI 모드 플래그, 설정
├── Tab               id, filePath, fileName, content, isDirty, encoding,
│                     wordCount/charCount/byteCount, savedAt
├── AppAction         (40여 가지 discriminated union)
├── appReducer        순수 함수, 사이드이펙트 없음
└── AppContext        useReducer → Provider → useApp() 훅
```

**원칙**: 상태는 `appStore.ts` 한 곳에만 존재. 컴포넌트는 `useApp()`으로 읽고 `dispatch()`로 쓴다.  
에디터 인스턴스(`crepeRef`)는 React 상태가 아닌 ref로 관리하며, 외부 접근이 필요한 경우에만 `crepeInstance` 모듈 수준 변수로 공개.

---

## 3. 에디터 레이어

```
Crepe (Milkdown)               ← 에디터 코어
  │
  ├── 기본 featureConfigs
  │     CodeMirror (언어 목록), Placeholder
  │
  ├── 커스텀 플러그인 ($prose / $remark 방식)
  │     highlightPlugin         형광펜 마크 스키마 + 입력규칙 + remark 직렬화
  │     blockSelectionPlugin    다중블록 텍스트 선택 → 블록 단위 스냅
  │     typographyPlugin        -- → em dash, ... → ellipsis 등
  │     urlDropPlugin           URL 드롭 → CustomEvent → Editor.tsx insertPos
  │
  ├── 설정 (editor.config)
  │     editorViewOptionsCtx    transformPastedHTML 체인 (paste-normalize)
  │     uploadConfig            tauriImageUploader
  │     blockConfig.filterNodes 모든 블록+listItem에 핸들 표시
  │
  └── 사이드 시스템 (vanilla JS, Crepe 마운트 후 연결)
        setupBlockDrag()        블록 드래그 앤 드롭 + 핸들 선택
        ImageOverlay            이미지 클릭 → 리사이즈/크롭 오버레이
```

---

## 4. 블록 드래그 & 핸들 선택 시스템

가장 복잡한 서브시스템. 세 파일로 분리되어 있다.

### 4-1. `block-drag-model.ts`
- `FlatBlock` 타입: `{ pos, size, level(0=top/1=listItem), node, parentPos, top, bottom }`
- `getFlatBlocks(view)`: doc을 순회해 FlatBlock 배열 반환 (list는 listItem 단위로 펼침)
- `findFlatBlockAtY(view, y)`: y좌표 기준 블록 탐색
- `computeSlot / getDropTarget`: 드롭 위치(inList 여부 포함) 계산
- `wrapInListItem`: level-0 노드를 list_item으로 감싸는 헬퍼

### 4-2. `block-list-handle.ts`
- `setupListItemHandles(containerEl, isPendingOrDragging)`: list_item에 mouseover 시 커스텀 드래그 핸들(`div.milkdown-li-handle`) 생성/삭제
- document.body에 `position:fixed` 엘리먼트를 직접 마운트하는 vanilla DOM 방식 (React 외부)

### 4-3. `block-drag.ts` (메인)

두 가지 독립적 시스템이 공존한다:

| 시스템 | 트리거 | 상태 | CSS 클래스 |
|--------|--------|------|-----------|
| **핸들 클릭 선택** | `.milkdown-block-handle` pointerdown | `selectedPositions: Set<number>` | `milkdown-block-selected` (classList 직접) |
| **드래그** | 핸들 pointerdown + 3px 이동 | `pending/dragging + sourceFlatBlock` | ghost 엘리먼트, indicator 라인 |
| **rubber-band** | gutter 영역 mousedown | `rbActive + rbEl` | 선택 완료 후 `milkdown-block-selected` |

이벤트 믹싱: rubber-band는 `mousedown/mousemove/mouseup`, 핸들 드래그는 `pointerdown/pointermove/pointerup`. 의도적 분리 — pointer 캡처가 rubber-band와 충돌하지 않도록.

트랜잭션 케이스 (pointerUp):
- **A/A'**: 멀티블록(level-0), inList 여부에 따라 list_item 래핑
- **B/B'**: 단일 level-0, inList 여부
- **C**: 단일 level-1 → inList 이동
- **D**: 단일 level-1 → level-0 lift (node.content 추출)

### 4-4. `block-selection-plugin.ts` (별개)

ProseMirror 플러그인. 텍스트 마우스 드래그가 블록 경계를 넘을 때 작동:
- `appendTransaction`: 선택을 블록 시작/끝으로 스냅
- `decorations`: `block-selected` 클래스 데코레이션
- `attributes`: `block-select-active` 클래스 → CSS로 텍스트 하이라이트 투명화

> **주의**: `block-drag.ts`의 `milkdown-block-selected`와 `block-selection-plugin.ts`의 `block-selected`는 **별개의 CSS 클래스**로 서로 다른 선택 시스템을 나타낸다. 시각적으로는 같은 효과(블록 하이라이트)이나 트리거와 메커니즘이 다르다.

---

## 5. 이미지 파이프라인

```
사용자 액션
  │
  ├── 파일 드롭/붙여넣기    → image-uploader.ts → assets/ 폴더 저장 → 상대경로 삽입
  ├── URL 드롭              → url-drop-plugin.ts → ![](url) 삽입
  ├── 툴바 이미지 버튼      → insert("\n![]()\n") → 사용자가 경로 입력
  │
  └── 이미지 클릭 (삽입 후)
        ↓
        ImageOverlay.tsx     fixed 포지션 오버레이 + 코너 핸들
          ├── 리사이즈 핸들 드래그  → imageOps.resizeImageFile() → Canvas → Tauri write_binary_file
          └── 크롭 버튼            → ImageCropModal (react-image-crop) → imageOps.cropImageFile() → 저장
```

크롭/리사이즈 후 원본 파일을 덮어쓰고, ProseMirror 노드의 `src` attr을 `?t=timestamp`로 캐시버스팅하여 업데이트.

---

## 6. Rust 백엔드 (src-tauri/src/lib.rs)

단일 파일. 커맨드 목록:

| 커맨드 | 용도 |
|--------|------|
| `read_file_with_encoding` | 인코딩별 파일 읽기 (encoding_rs) |
| `write_file_with_encoding` | 인코딩별 파일 쓰기 |
| `write_binary_file` | 이미지 크롭/리사이즈 결과 저장 |
| `watch_file / unwatch_file` | 파일 변경 감시 (notify crate) |
| `get/add/remove_recent_file` | 최근 파일 목록 (JSON) |
| `save/delete/list/read_draft` | 자동 초안 저장 (60초 간격) |
| `save_version_snapshot` | Cmd+S 시 버전 백업 (최대 30개) |
| `save_temp_file` | 종료 전 임시 저장 (CloseDialog) |

네이티브 메뉴는 Tauri menu API로 빌드하고, `on_menu_event`에서 이벤트 이름을 그대로 emit → 프론트엔드 `useMenu.ts`에서 `listen()`으로 수신.

---

## 7. 알려진 설계 특이사항

### crepeInstance 전역 변수
`Editor.tsx`가 `export let crepeInstance`를 모듈 수준 변수로 공개한다. `Toolbar.tsx`와 `url-drop-plugin.ts`가 이를 직접 참조한다. React Context를 통해 전달하는 것이 이상적이나, ProseMirror 명령 실행은 렌더 사이클 밖에서 일어나므로 ref/global 방식이 현실적이다.

### useFile.ts 이중 역할
파일 I/O 로직과 단축키 이벤트 리스너, 파일 감시 리스너를 한 훅에서 관리한다. 훅 분리 여지가 있으나 현재 규모에선 허용 범위.

### 초안 복구 UI 미구현
`useAutoDraft.ts`의 `clearDraft / listDrafts / readDraft`는 크래시 복구 UI를 위해 내보내지고 있으나 아직 이를 호출하는 컴포넌트가 없다. 앱 시작 시 복구 제안 다이얼로그 구현이 남아있다.

### #47 URL 드래그앤드롭
`url-drop-plugin.ts`가 구현되어 있다. `view.dom`에서 dispatch된 `md-url-drop` CustomEvent가 `bubbles: true`이므로 `containerEl`까지 정상 전파된다. 기능은 완성 상태이나 end-to-end 테스트 미완.
