import { useCurrentFrame } from "remotion";
import { cue, enter, rise, typed } from "../lib";
import { Caret, TermBar } from "../parts";

// huddle watch in a spare terminal: the conversation scrolls by, you step in, your message goes first,
// and the plan waits for your yes.
interface Entry {
  who: "claude" | "codex" | "you";
  to: string;
  body: string;
  at: number;
  first?: boolean;
}

const COLORS = { claude: "#ec9068", codex: "#78a8ff", you: "#ececec" };
const NAMES = { claude: "Claude", codex: "Codex", you: "You" };
const ROW = 84;

export function Watch() {
  const frame = useCurrentFrame();
  const liveAt = cue("watch", "follow") - 6;
  const stepAt = cue("watch", "Step");
  const firstAt = cue("watch", "first,") - 6;
  const askAt = cue("watch", "nothing") - 4;
  const yesAt = cue("watch", "yes.") - 10;
  const sendAt = cue("watch", "message") - 6;

  const steer = "also check the refund path";
  const entries: Entry[] = [
    { who: "claude", to: "Codex", body: "Two retries can overlap. Lock retry() in worker.py?", at: liveAt },
    { who: "codex", to: "Claude", body: "Disagree: runner.py:88 retries jobs that already committed.", at: liveAt + 12 },
    { who: "claude", to: "Codex", body: "Right, lock dropped. Skip the retry once committed?", at: liveAt + 24 },
    { who: "you", to: "both", body: steer, at: sendAt + 4, first: true },
    { who: "codex", to: "Claude", body: "Agreed, and the refund path has the same retry. Same fix.", at: firstAt + 22 },
    { who: "claude", to: "you", body: "We agree on one bug and its fix. Should I make it?", at: askAt },
    { who: "you", to: "Claude", body: "yes", at: yesAt + 16 },
  ];

  const visible = entries.filter((entry) => frame >= entry.at).length;

  // The prompt: you type to both, send it; later you type "yes".
  const typing = frame < sendAt ? typed(steer, frame, stepAt - 4, 30) : frame >= yesAt && frame < yesAt + 16 ? typed("yes", frame, yesAt, 10) : "";
  const boxIn = rise(frame, 0, 20);

  return (
    <div className="scene">
      <div style={{ position: "absolute", left: 0, right: 0, top: 76, textAlign: "center", ...enter(rise(frame, 0, 20)) }}>
        <h2 style={{ fontSize: 58 }}>
          You stay <span className="soft">in charge.</span>
        </h2>
      </div>

      <div className="term" style={{ position: "absolute", left: 300, top: 196, width: 1320, height: 820, ...enter(boxIn, 20) }}>
        <TermBar title="huddle watch" />
        <div style={{ position: "absolute", top: 64, left: 0, right: 0, bottom: 112, overflow: "hidden", padding: "26px 40px" }}>
          <div>
            {entries.map((entry, index) => {
              const k = rise(frame, entry.at, 14);
              if (k <= 0) return null;
              return (
                <div key={index} style={{ height: ROW, ...enter(k, 8) }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 23 }}>
                    <span className="dot" style={{ width: 11, height: 11, background: COLORS[entry.who] }} />
                    <span className="term-strong" style={{ fontWeight: 500 }}>
                      {NAMES[entry.who]}
                    </span>
                    <span className="term-dim">to {entry.to}</span>
                    {entry.first ? (
                      <span style={{ marginLeft: 6, padding: "2px 12px", borderRadius: 99, border: "1.5px solid #ffffff22", color: "var(--term-strong)", fontSize: 18, opacity: rise(frame, firstAt, 14) }}>
                        read first
                      </span>
                    ) : null}
                  </div>
                  <div style={{ paddingLeft: 25, fontSize: 24, color: entry.who === "you" ? "var(--term-strong)" : undefined }}>{entry.body}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* The prompt line */}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 112, padding: "0 40px", display: "flex", alignItems: "center", borderTop: "1.5px solid #ffffff0d", fontSize: 25 }}>
          <span className="term-strong" style={{ fontWeight: 600, marginRight: 16 }}>
            {frame >= askAt ? "to Claude ›" : "to both ›"}
          </span>
          {typing ? <span className="term-strong">{typing}</span> : <span className="term-dim">{frame >= askAt ? "message Claude · Tab to switch" : "message both agents · Tab to pick one"}</span>}
          <Caret frame={frame} solid={typing.length > 0} />
          <span className="term-dim" style={{ marginLeft: "auto", fontSize: 20 }}>
            {visible} messages
          </span>
        </div>
      </div>
    </div>
  );
}
