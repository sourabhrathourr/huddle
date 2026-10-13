import { useCurrentFrame } from "remotion";
import { EASE_IN_OUT, cue, enter, mix, rise } from "../lib";
import { ClaudeLogo, CodexLogo, Wordmark } from "../parts";

// The name, then the promise, then the line between the two agents drawn whole.
// One thing moves at a time: the name arrives, settles, rises into place, and only then does the headline come in.
const MARK = 120; // the name's size while it stands alone
const MARK_TOP = 290; // where its centre ends up
const MARK_END = 64 / MARK;

export function Reveal() {
  const frame = useCurrentFrame();
  const markIn = rise(frame, cue("reveal", "Meet") - 2, 26);
  // The name holds still for a beat after it lands, then rises; the headline waits until it has arrived.
  const liftAt = cue("reveal", "huddle.") + 12;
  const lift = rise(frame, liftAt, 26, EASE_IN_OUT);
  const headAt = Math.max(liftAt + 26, cue("reveal", "lets") - 2);
  const headIn = rise(frame, headAt, 22);
  const softIn = rise(frame, Math.max(headAt + 8, cue("reveal", "talk") - 4), 22);
  const lineIn = rise(frame, cue("reveal", "Directly.") - 6, 30, EASE_IN_OUT);

  return (
    <div className="scene">
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          transform: `translateY(${mix(0, MARK_TOP - 540, lift).toFixed(2)}px) scale(${mix(1, MARK_END, lift).toFixed(4)})`,
          ...{ opacity: markIn, filter: markIn < 1 ? `blur(${mix(6, 0, markIn).toFixed(2)}px)` : undefined },
        }}
      >
        <Wordmark size={MARK} />
      </div>

      <div style={{ position: "absolute", left: 0, right: 0, top: 420, textAlign: "center" }}>
        <h1 style={{ fontSize: 92 }}>
          <span style={{ display: "block", ...enter(headIn) }}>Let Claude Code and Codex</span>
          <span className="soft" style={{ display: "block", ...enter(softIn) }}>
            talk to each other.
          </span>
        </h1>
      </div>

      {/* The two marks joined by one unbroken line */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 770, display: "flex", justifyContent: "center", alignItems: "center", opacity: rise(frame, cue("reveal", "Directly.") - 10, 16) }}>
        <ClaudeLogo style={{ width: 54, height: 54 }} />
        <svg width={420} height={20} style={{ margin: "0 26px" }}>
          <line x1={0} y1={10} x2={420 * lineIn} y2={10} stroke="var(--anatomy-strong)" strokeWidth={2} strokeLinecap="round" />
          <circle cx={420 * lineIn} cy={10} r={5} fill="var(--claude)" opacity={lineIn > 0 && lineIn < 1 ? 1 : 0} />
        </svg>
        <CodexLogo style={{ width: 52, height: 52, color: "var(--anatomy-strong)" }} />
      </div>
    </div>
  );
}
