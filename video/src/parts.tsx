import * as React from "react";
import { ClaudeLogo, CodexLogo } from "../../site/components/logos";

export { ClaudeLogo, CodexLogo };

export function Wordmark({ size, blink = 0 }: { size: number; blink?: number }) {
  // `blink` is the frame count; the cursor blinks at a calm 1 Hz like a terminal's.
  const on = blink < 30 || Math.floor(blink / 15) % 2 === 0;
  return (
    <span className="wm" style={{ fontSize: size }}>
      huddle
      <i style={{ opacity: on ? 1 : 0 }} />
    </span>
  );
}

export function AppTile({ agent, note, style }: { agent: "claude" | "codex"; note?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="app" style={style}>
      <div className="app-tile">{agent === "claude" ? <ClaudeLogo /> : <CodexLogo style={{ color: "var(--anatomy-strong)" }} />}</div>
      <span className="app-name">{agent === "claude" ? "Claude Code" : "Codex"}</span>
      {note ? <span className="app-note">{note}</span> : null}
    </div>
  );
}

export function TermBar({ agent, title }: { agent?: "claude" | "codex"; title: string }) {
  return (
    <div className="term-bar">
      <span className="term-lights">
        <i />
        <i />
        <i />
      </span>
      {agent === "claude" ? <ClaudeLogo /> : agent === "codex" ? <CodexLogo style={{ color: "#ececec" }} /> : null}
      {title}
    </div>
  );
}

export function Caret({ frame, solid = false }: { frame: number; solid?: boolean }) {
  const on = solid || Math.floor(frame / 15) % 2 === 0;
  return <span className="caret" style={{ opacity: on ? 1 : 0 }} />;
}
