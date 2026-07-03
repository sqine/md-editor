import { useState } from "react";
import { useApp } from "../../shared/store/appStore";
import type { FontFamily, Encoding } from "../../shared/store/appStore";
import { getFontStack } from "../../shared/lib/fonts";
import "./Settings.css";

type Tab = "personal" | "plugins" | "file";

export default function Settings() {
  const { state, dispatch } = useApp();
  const [tab, setTab] = useState<Tab>("personal");

  if (!state.settingsOpen) return null;

  return (
    <div id="settings-overlay" onClick={(e) => {
      if (e.target === e.currentTarget) dispatch({ type: "TOGGLE_SETTINGS" });
    }}>
      <div id="settings-modal">
        <div id="settings-header">
          <span>설정</span>
          <button onClick={() => dispatch({ type: "TOGGLE_SETTINGS" })}>✕</button>
        </div>
        <div id="settings-body">
          <nav id="settings-nav">
            <NavBtn active={tab === "personal"} onClick={() => setTab("personal")}>🎨 개인 설정</NavBtn>
            <NavBtn active={tab === "plugins"}  onClick={() => setTab("plugins")}>🧩 플러그인</NavBtn>
            <NavBtn active={tab === "file"}     onClick={() => setTab("file")}>📁 파일 설정</NavBtn>
          </nav>
          <div id="settings-content">
            {tab === "personal" && <PersonalTab />}
            {tab === "plugins"  && <PluginsTab />}
            {tab === "file"     && <FileTab />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 개인 설정 ─────────────────────────────────────────────────

function PersonalTab() {
  const { state, dispatch } = useApp();

  const fonts: { value: FontFamily; label: string; sample: string }[] = [
    { value: "system",     label: "시스템 기본",     sample: "The quick brown fox" },
    { value: "serif",      label: "명조체",           sample: "The quick brown fox" },
    { value: "mono",       label: "고정폭 (Mono)",    sample: "The quick brown fox" },
    { value: "pretendard", label: "Pretendard",       sample: "안녕하세요 Hello" },
    { value: "nanum",      label: "나눔고딕",         sample: "안녕하세요 Hello" },
  ];

  return (
    <div className="tab-content">
      <Section title="테마">
        <div className="theme-row">
          {(["light", "dark"] as const).map((t) => (
            <button
              key={t}
              className={`theme-card ${state.theme === t ? "active" : ""}`}
              onClick={() => dispatch({ type: "SET_THEME", theme: t })}
            >
              <ThemePreview mode={t} />
              <span>{t === "light" ? "라이트" : "다크"}</span>
              {state.theme === t && <Badge />}
            </button>
          ))}
        </div>
      </Section>

      <Section title="글씨체">
        <div className="font-list">
          {fonts.map((f) => (
            <button
              key={f.value}
              className={`font-card ${state.fontFamily === f.value ? "active" : ""}`}
              style={{ fontFamily: getFontStack(f.value) }}
              onClick={() => dispatch({ type: "SET_FONT_FAMILY", fontFamily: f.value })}
            >
              <span className="font-sample">{f.sample}</span>
              <span className="font-name">{f.label}</span>
              {state.fontFamily === f.value && <Badge />}
            </button>
          ))}
        </div>
      </Section>

      <Section title="글꼴 크기">
        <div className="size-row">
          <button className="size-btn" onClick={() => dispatch({ type: "SET_FONT_SIZE", size: state.fontSize - 1 })}>−</button>
          <span className="size-val">{state.fontSize}px</span>
          <button className="size-btn" onClick={() => dispatch({ type: "SET_FONT_SIZE", size: state.fontSize + 1 })}>+</button>
          <input
            type="range" min={10} max={32} value={state.fontSize}
            onChange={(e) => dispatch({ type: "SET_FONT_SIZE", size: +e.target.value })}
            className="size-slider"
          />
          <button className="size-reset" onClick={() => dispatch({ type: "SET_FONT_SIZE", size: 15 })}>초기화</button>
        </div>
      </Section>
    </div>
  );
}

// ── 플러그인 ──────────────────────────────────────────────────

function PluginsTab() {
  return (
    <div className="tab-content">
      <Section title="플러그인">
        <div className="empty-state">
          <span>🧩</span>
          <p>설치된 플러그인이 없습니다.</p>
          <p className="muted">플러그인 마켓플레이스는 준비 중입니다.</p>
        </div>
      </Section>
    </div>
  );
}

// ── 파일 설정 ─────────────────────────────────────────────────

function FileTab() {
  const { state, dispatch } = useApp();

  const encodings: { value: Encoding; label: string; desc: string }[] = [
    { value: "UTF-8",   label: "UTF-8",          desc: "권장 — 유니코드 표준" },
    { value: "EUC-KR",  label: "EUC-KR",         desc: "레거시 한국어 인코딩" },
    { value: "CP949",   label: "CP949 (MS949)",   desc: "Windows 한국어 인코딩" },
  ];

  return (
    <div className="tab-content">
      <Section title="기본 인코딩">
        <p className="desc">새 파일을 열거나 저장할 때 기본으로 사용할 인코딩입니다.</p>
        <div className="radio-group">
          {encodings.map((e) => (
            <label key={e.value} className={`radio-card ${state.defaultEncoding === e.value ? "active" : ""}`}>
              <input
                type="radio" name="encoding" value={e.value}
                checked={state.defaultEncoding === e.value}
                onChange={() => dispatch({ type: "SET_DEFAULT_ENCODING", encoding: e.value })}
              />
              <div>
                <span className="rl">{e.label}</span>
                <span className="rd">{e.desc}</span>
              </div>
            </label>
          ))}
        </div>
      </Section>

      <Section title="파일 동작">
        <div className="toggle-list">
          <ToggleRow
            label="외부 변경 자동 감지"
            desc="다른 앱에서 파일을 수정하면 자동으로 리로드합니다."
            checked={state.autoReload}
            onChange={(v) => dispatch({ type: "SET_AUTO_RELOAD", value: v })}
          />
          <ToggleRow
            label="포커스 잃을 때 자동 저장"
            desc="에디터 창에서 포커스가 벗어나면 자동으로 저장합니다."
            checked={state.saveOnFocusLoss}
            onChange={(v) => dispatch({ type: "SET_SAVE_ON_FOCUS_LOSS", value: v })}
          />
        </div>
      </Section>
    </div>
  );
}

// ── 공통 ──────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="section">
      <h3 className="section-title">{title}</h3>
      {children}
    </div>
  );
}

function NavBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={active ? "active" : ""} onClick={onClick}>{children}</button>
  );
}

function Badge() {
  return <span className="badge">✓</span>;
}

function ThemePreview({ mode }: { mode: "light" | "dark" }) {
  return (
    <div className={`theme-preview ${mode}`}>
      <div className="tp-bar" />
      <div className="tp-body">
        <div className="tp-line w80" /><div className="tp-line w60" /><div className="tp-line w70" />
      </div>
    </div>
  );
}

function ToggleRow({ label, desc, checked, onChange }: {
  label: string; desc: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="toggle-row">
      <div>
        <div className="tl">{label}</div>
        <div className="td">{desc}</div>
      </div>
      <button
        className={`toggle ${checked ? "on" : ""}`}
        onClick={() => onChange(!checked)}
        role="switch" aria-checked={checked}
      >
        <span className="knob" />
      </button>
    </div>
  );
}
