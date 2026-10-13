import { useCurrentFrame } from "remotion";
import { cue, enter, rise } from "../lib";

// Not an echo chamber: they push back, they say when they're persuaded, and every question closes the same way.
export function Principle() {
  const frame = useCurrentFrame();
  const head = rise(frame, cue("principle", "That's") - 4, 20);
  const soft = rise(frame, cue("principle", "agree") - 6, 20);
  const points = [
    { text: "Push back with evidence.", at: cue("principle", "push") - 6 },
    { text: "Say when persuaded.", at: cue("principle", "say") - 6 },
  ];
  const card = rise(frame, cue("principle", "close") - 6, 22);
  const rows = [
    { key: "Agreed", value: "skip the retry once a job is committed", at: cue("principle", "agreed,") - 4 },
    { key: "Open", value: "nothing", at: cue("principle", "open,") - 4 },
    { key: "Next", value: "Claude → runner.py · Codex → the tests", at: cue("principle", "next.") - 6 },
  ];

  return (
    <div className="scene">
      <div style={{ position: "absolute", left: 200, top: 340, width: 720 }}>
        <h1 style={{ fontSize: 80, ...enter(head) }}>
          They don&apos;t just
          <br />
          <span className="soft" style={{ opacity: soft }}>
            agree.
          </span>
        </h1>
        <div style={{ marginTop: 56, display: "grid", gap: 18 }}>
          {points.map((point) => (
            <p key={point.text} style={{ fontSize: 34, color: "var(--anatomy-strong)", letterSpacing: "-0.02em", display: "flex", alignItems: "center", gap: 20, ...enter(rise(frame, point.at, 18), 10) }}>
              <span style={{ width: 28, height: 2, background: "var(--claude)" }} />
              {point.text}
            </p>
          ))}
        </div>
      </div>

      {/* How every settled question closes */}
      <div
        style={{
          position: "absolute",
          left: 1000,
          top: 370,
          width: 720,
          padding: "34px 40px 20px",
          border: "1.5px solid var(--hairline)",
          borderRadius: 26,
          background: "var(--anatomy-card)",
          ...enter(card, 20),
        }}
      >
        <div className="mono" style={{ color: "var(--anatomy-muted)", fontSize: 20, marginBottom: 18 }}>
          settled · huddle 1
        </div>
        {rows.map((row, index) => (
          <div
            key={row.key}
            style={{
              display: "grid",
              gridTemplateColumns: "150px 1fr",
              alignItems: "baseline",
              padding: "22px 0",
              borderTop: index ? "1.5px solid var(--hairline)" : "none",
              ...enter(rise(frame, row.at, 16), 8),
            }}
          >
            <span style={{ color: "var(--anatomy-muted)", fontSize: 26, fontWeight: 500 }}>{row.key}</span>
            <span style={{ color: "var(--anatomy-strong)", fontSize: 28, letterSpacing: "-0.01em" }}>{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
