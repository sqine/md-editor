# 종료 처리 로직

## 개요

사용자가 앱을 닫을 때 미저장 내용이 있으면 데이터 손실을 방지하기 위한 처리 흐름입니다.

## 흐름도

```
사용자가 창 닫기 (X 버튼 / Cmd+Q)
        │
        ▼
  isDirty?
  ├─ No  ──────────────────────────────────────────▶ 바로 종료
  │
  └─ Yes ──▶ CloseDialog 표시
                    │
                    ├─ [저장하고 종료]
                    │     └─ filePath 있음? → 현재 파일에 저장 → 종료
                    │         filePath 없음? → 다른 이름으로 저장 다이얼로그 → 종료
                    │
                    ├─ [임시 파일로 저장 후 종료]
                    │     └─ {appDataDir}/temp/{파일명}_{타임스탬프}.md 에 저장
                    │         경로 표시 확인 화면 → 종료
                    │
                    ├─ [저장하지 않고 종료]
                    │     └─ 바로 종료 (내용 손실)
                    │
                    └─ [취소]
                          └─ 닫기 취소, 에디터로 복귀
```

## 구현 위치

| 파일 | 역할 |
|------|------|
| `src/features/file/useCloseHandler.ts` | Tauri `onCloseRequested` 이벤트 인터셉트 |
| `src/widgets/close-dialog/CloseDialog.tsx` | 종료 확인 모달 UI |
| `src-tauri/src/lib.rs` → `save_temp_file` | 임시 파일 저장 Rust 커맨드 |

## 임시 파일 경로

```
{appDataDir}/temp/{원본파일명}_{Unix타임스탬프}.md
```

예시 (macOS):
```
~/Library/Application Support/com.bagtaehun.md-editor/temp/my-doc_1750000000.md
```

- 앱이 다음에 실행될 때 이 경로의 파일을 직접 열어서 복구할 수 있습니다.
- 임시 파일은 자동으로 삭제되지 않으므로 직접 관리가 필요합니다.

## 기술 세부사항

### `useCloseHandler`

```ts
// 클로저 문제 방지: isDirty 최신값을 ref로 추적
const isDirtyRef = useRef(state.isDirty);
useEffect(() => { isDirtyRef.current = state.isDirty; }, [state.isDirty]);

// onCloseRequested는 한 번만 등록 (deps: [dispatch])
getCurrentWindow().onCloseRequested((event) => {
  if (isDirtyRef.current) {
    event.preventDefault(); // 종료 차단
    dispatch({ type: "SET_CLOSE_DIALOG", open: true });
  }
  // isDirty 아니면 preventDefault 없음 → 자연 종료
});
```

**왜 ref를 쓰는가?**
`useEffect`의 deps에 `state.isDirty`를 넣으면 값이 바뀔 때마다 이벤트 리스너를 재등록하게 되고, 이전 리스너 해제 타이밍에 따라 이중 등록 문제가 생길 수 있습니다. ref로 최신값을 참조하면 리스너를 한 번만 등록하면서도 항상 올바른 값을 읽을 수 있습니다.

### `save_temp_file` (Rust)

```rust
fn save_temp_file(content: String, filename: String, app: AppHandle) -> Result<String, String>
```

- `app.path().app_data_dir()` 로 앱 데이터 디렉토리 확인
- `temp/` 하위 디렉토리를 없으면 생성 (`create_dir_all`)
- `{stem}_{unix_timestamp}.md` 파일명으로 저장
- 저장된 전체 경로를 문자열로 반환

### 상태 (AppStore)

```ts
closeDialogOpen: boolean  // CloseDialog 표시 여부
```

액션:
```ts
{ type: "SET_CLOSE_DIALOG"; open: boolean }
```
