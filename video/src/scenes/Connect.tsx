import { useCurrentFrame } from "remotion";
import { EASE_IN_OUT, cue, enter, rise, typed } from "../lib";
import { Caret, TermBar } from "../parts";

// Two terminals. /huddle in one, $huddle in the other, and they're connected.
const W = 760;
const H = 330;

function Terminal({
  agent,
  title,
  prompt,
  command,
  typeAt,
  lines,
  frame,
  style,
}: {
  agent: "claude" | "codex";
  title: string;
  prompt: string;
  command: string;
  typeAt: number;
  lines: { at: number; node: React.ReactNode }[];
  frame: number;
  style: React.CSSProperties;
}) {
  const shown = typed(command, frame, typeAt, 16);
  const done = shown.length === command.length && frame > typeAt + 10;
  return (
    <div className="term" style={{ position: "absolute", width: W, height: H, ...style }}>
      <TermBar agent={agent} title={title} />
      <div className="term-body">
        <div>
          <span className="term-dim">{prompt} </span>
          <span className="term-strong">{shown}</span>
          {!done ? <Caret frame={frame} solid={frame >= typeAt && frame < typeAt + 14} /> : null}
        </div>
        {lines.map((line, index) => (
          <div key={index} style={{ ...enter(rise(frame, line.at, 14), 8), marginTop: index === 0 ? 14 : 0 }}>
            {line.node}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Connect() {
  const frame = useCurrentFrame();
  const leftIn = rise(frame, 0, 22);
  const rightIn = rise(frame, 6, 22);
  const slashAt = cue("connect", "slash");
  const dollarAt = cue("connect", "dollar");
  const thatsAt = cue("connect", "That's");
  const link = rise(frame, thatsAt - 8, 22, EASE_IN_OUT);
  const tags = [
    { text: "no codes", at: cue("connect", "codes.") - 4 },
    { text: "no IDs", at: cue("connect", "IDs.") - 4 },
    { text: "one thread each", at: cue("connect", "thread,") - 8 },
    { text: "connected until you end it", at: cue("connect", "connected") - 6 },
  ];

  const top = 330;
  return (
    <div className="scene">
      <div style={{ position: "absolute", top: 190, left: 0, right: 0, textAlign: "center", ...enter(rise(frame, 2, 20)) }}>
        <h2 style={{ fontSize: 58 }}>
          Two commands. <span className="soft">That&apos;s it.</span>
        </h2>
      </div>

      <Terminal
        agent="claude"
        title="Claude Code"
        prompt=">"
        command="/huddle"
        typeAt={slashAt - 2}
        frame={frame}
        style={{ top, left: 960 - W - 50, ...enter(leftIn, 20) }}
        lines={[
          { at: slashAt + 22, node: <span className="term-dim">⏺ huddle 1 started · waiting for Codex</span> },
          { at: thatsAt - 8, node: <span><span style={{ color: "#ec9068" }}>●</span> <span className="term-strong">Codex joined.</span> <span className="term-dim">listening</span></span> },
        ]}
      />
      <Terminal
        agent="codex"
        title="Codex"
        prompt="›"
        command="$huddle"
        typeAt={dollarAt - 2}
        frame={frame}
        style={{ top, left: 960 + 50, ...enter(rightIn, 20) }}
        lines={[
          { at: dollarAt + 22, node: <span className="term-dim">• joining huddle 1 with Claude Code</span> },
          { at: thatsAt - 8, node: <span><span style={{ color: "#78a8ff" }}>●</span> <span className="term-strong">Connected.</span> <span className="term-dim">woken by codex queue</span></span> },
        ]}
      />

      {/* The link between the two windows */}
      <svg style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080 }}>
        <line x1={960 - 50} y1={top + H / 2} x2={960 - 50 + 100 * link} y2={top + H / 2} stroke="var(--anatomy-strong)" strokeWidth={2.5} strokeLinecap="round" opacity={link > 0 ? 1 : 0} />
        <circle cx={960 - 50} cy={top + H / 2} r={6} fill="var(--claude)" opacity={link > 0 ? 1 : 0} />
        <circle cx={960 + 50} cy={top + H / 2} r={6} fill="var(--codex)" opacity={link >= 1 ? 1 : 0} />
      </svg>

      <div style={{ position: "absolute", top: top + H + 64, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 16 }}>
        {tags.map((tag) => (
          <span key={tag.text} className="pill" style={{ fontSize: 23, ...enter(rise(frame, tag.at, 16), 10) }}>
            {tag.text}
          </span>
        ))}
      </div>
    </div>
  );
}
