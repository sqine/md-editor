/**
 * useAutoDraft — 자동 초안 저장 (크래시 복구용)
 *
 * 동작 방식:
 *  - 탭이 dirty 상태이고 60초마다 → app_data/drafts/{tabId}.md 에 저장
 *  - 앱 시작 시 drafts/ 폴더 확인 → 복구 가능한 초안이 있으면 반환
 *  - 정상 저장(saveFile) 시 → 해당 탭의 초안 삭제
 *
 * 버전 관리(레이어 3):
 *  - Cmd+S 성공 시 useFile.ts 에서 invoke("save_version_snapshot") 호출
 *  - Rust 쪽에서 {file}.md_versions/{YYYY-MM-DD_HH-MM-SS}.md 로 복사
 */
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "../../shared/store/appStore";

const DRAFT_INTERVAL_MS = 60_000; // 60초

export function useAutoDraft() {
  const { state } = useApp();
  const lastSavedRef = useRef<Map<string, string>>(new Map()); // tabId → last drafted content

  useEffect(() => {
    const id = setInterval(async () => {
      for (const tab of state.tabs) {
        if (!tab.isDirty) continue;
        const prev = lastSavedRef.current.get(tab.id);
        if (prev === tab.content) continue; // 변경 없으면 스킵

        try {
          await invoke("save_draft", {
            tabId: tab.id,
            fileName: tab.fileName,
            content: tab.content,
          });
          lastSavedRef.current.set(tab.id, tab.content);
        } catch {
          // 초안 저장 실패는 조용히 무시
        }
      }
    }, DRAFT_INTERVAL_MS);

    return () => clearInterval(id);
  }, [state.tabs]);

  // 탭이 닫히거나 저장되면 초안 삭제
  useEffect(() => {
    for (const tab of state.tabs) {
      if (!tab.isDirty && lastSavedRef.current.has(tab.id)) {
        invoke("delete_draft", { tabId: tab.id }).catch(() => {});
        lastSavedRef.current.delete(tab.id);
      }
    }
  }, [state.tabs]);
}

/** 저장 성공 후 외부에서 호출: 해당 탭 초안 삭제 */
export async function clearDraft(tabId: string) {
  await invoke("delete_draft", { tabId }).catch(() => {});
}

/** 앱 시작 시 복구 가능한 초안 목록 조회 */
export async function listDrafts(): Promise<{ tabId: string; fileName: string; savedAt: number }[]> {
  return invoke<{ tabId: string; fileName: string; savedAt: number }[]>("list_drafts").catch(() => []);
}

/** 특정 초안 내용 읽기 */
export async function readDraft(tabId: string): Promise<string> {
  return invoke<string>("read_draft", { tabId }).catch(() => "");
}
