import { useCurrentFrame } from "remotion";
import { EASE_IN_OUT, cue, enter, mix, rise } from "../lib";
import { ClaudeLogo, CodexLogo, Wordmark } from "../parts";

// One command, then the name.
export function Close() {
  const frame = useCurrentFrame();
  const command = rise(frame, cue("close", "command") - 10, 22);
  const pair = rise(frame, cue("close", "Two") - 6, 20);
  const one = rise(frame, cue("close", "One", 1) - 6, 20);
  // The install and the pair leave fully before the name arrives, so the two never overlap.
  const out = rise(frame, cue("close", "huddle.") - 24, 12, EASE_IN_OUT);
  const name = rise(frame, cue("close", "huddle.") - 8, 26);
  const tagline = rise(frame, cue("close", "Let") - 6, 22);

  return (
    <div className="scene">
      {/* The install, then the pair, before the name takes the screen */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 400, display: "grid", justifyItems: "center", gap: 64, opacity: 1 - out, transform: `translateY(${mix(0, -20, out)}px)` }}>
        <div className="command" style={enter(command, 16)}>
          <code>
            <span className="prompt">$</span>curl -fsSL huddle.top/install | sh
          </code>
          <span className="copy">Copy</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 28, fontSize: 64, fontWeight: 600, letterSpacing: "-0.045em", color: "var(--anatomy-strong)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 22, ...enter(pair, 12) }}>
            <ClaudeLogo style={{ width: 52, height: 52 }} />
            <CodexLogo style={{ width: 50, height: 50, color: "var(--anatomy-strong)" }} />
            Two agents.
          </span>
          <span className="soft" style={enter(one, 12)}>
            One conversation.
          </span>
        </div>
      </div>

      <div style={{ position: "absolute", left: 0, right: 0, top: 400, display: "grid", justifyItems: "center", gap: 34, opacity: name, transform: `translateY(${mix(20, 0, name)}px)`, filter: name < 1 ? `blur(${mix(6, 0, name).toFixed(2)}px)` : undefined }}>
        <Wordmark size={150} blink={frame} />
        <p style={{ fontSize: 44, fontWeight: 500, letterSpacing: "-0.03em", color: "var(--anatomy-muted)", ...enter(tagline, 10) }}>
          Let them talk. <span style={{ color: "var(--anatomy-strong)" }}>huddle.top</span>
        </p>
      </div>
    </div>
  );
}
