"use client";

import * as React from "react";
import { ClaudeLogo, CodexLogo } from "./logos";
import "./talk.css";

type Agent = "claude" | "codex";

interface Line {
  from: Agent;
  chip: string;
  // The same message, short enough for the narrow track on a phone.
  short: string;
}

// Four turns of one huddle: a proposal, a rejection with a reason, a better idea, agreement.
const LINES: Line[] = [
  { from: "claude", chip: "lock retry()?", short: "lock?" },
  { from: "codex", chip: "no · runner.py:88", short: "no · :88" },
  { from: "claude", chip: "skip if committed?", short: "skip it?" },
  { from: "codex", chip: "agreed", short: "agreed" },
];

const NAMES: Record<Agent, string> = { claude: "Claude Code", codex: "Codex" };
const TRAVEL = 1300; // must match --talk-travel in talk.css
const TURN = 3600;
const SETTLE = 3200;
const RESET = 500;

type Stage = { turn: number; landed: boolean; done: boolean; cycle: number };

function useInView(ref: React.RefObject<Element | null>) {
  const [seen, setSeen] = React.useState(false);
  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const watch = new IntersectionObserver(([entry]) => setSeen(Boolean(entry?.isIntersecting)), { threshold: 0.35 });
    watch.observe(node);
    return () => watch.disconnect();
  }, [ref]);
  return seen;
}

function useStill() {
  return React.useSyncExternalStore(
    (changed) => {
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      query.addEventListener("change", changed);
      return () => query.removeEventListener("change", changed);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

function Tile({ agent, status, receiving }: { agent: Agent; status: string; receiving: string | null }) {
  return (
    <div className="talk-agent" data-who={agent}>
      <div className="talk-tile">
        {receiving ? <span key={receiving} className="talk-ring" aria-hidden="true" /> : null}
        {agent === "claude" ? <ClaudeLogo className="talk-logo" /> : <CodexLogo className="talk-logo" />}
      </div>
      <span className="talk-name">{NAMES[agent]}</span>
      <span className="talk-status" data-status={status}>
        {status}
      </span>
    </div>
  );
}

export function Talk() {
  const root = React.useRef<HTMLDivElement>(null);
  const seen = useInView(root);
  const still = useStill();
  const [stage, setStage] = React.useState<Stage>({ turn: -1, landed: false, done: false, cycle: 0 });

  // One timer at a time walks the conversation: send, land, next; then hold the agreement and start over.
  React.useEffect(() => {
    if (still || !seen) return;
    const { turn, landed, done } = stage;
    let next: Partial<Stage>;
    let wait: number;
    if (done) {
      next = { turn: -1, landed: false, done: false, cycle: stage.cycle + 1 };
      wait = SETTLE;
    } else if (turn === -1) {
      next = { turn: 0, landed: false };
      wait = RESET;
    } else if (!landed) {
      next = { landed: true };
      wait = TRAVEL;
    } else if (turn < LINES.length - 1) {
      next = { turn: turn + 1, landed: false };
      wait = TURN - TRAVEL;
    } else {
      next = { done: true };
      wait = TURN - TRAVEL;
    }
    const timer = window.setTimeout(() => setStage((was) => ({ ...was, ...next })), wait);
    return () => window.clearTimeout(timer);
  }, [stage, seen, still]);

  const { turn, landed, done, cycle } = still ? { turn: LINES.length - 1, landed: true, done: true, cycle: 0 } : stage;
  const line = LINES[turn];
  const sending = line && !landed ? line.from : null;
  const to = (agent: Agent): Agent => (agent === "claude" ? "codex" : "claude");
  const statusOf = (agent: Agent) => {
    if (done) return "agreed";
    if (!line) return "listening";
    if (sending === agent) return "sending";
    if (landed && to(line.from) === agent) return "reading";
    return "listening";
  };

  return (
    <div ref={root} className="talk" data-done={done ? "" : undefined} data-still={still ? "" : undefined}>
      <div className="talk-stage">
        <Tile agent="claude" status={statusOf("claude")} receiving={line && landed && line.from === "codex" ? `${cycle}-${turn}` : null} />
        <div className="talk-track" aria-hidden="true">
          <span className="talk-rail" data-active={sending ?? undefined} />
          {line && sending ? (
            <span key={`${cycle}-${turn}`} className="talk-carrier" data-dir={line.from === "claude" ? "right" : "left"}>
              <span className="talk-chip" data-who={line.from}>
                <span className="talk-chip-face">
                  {line.from === "codex" ? <span className="talk-arrow">←</span> : null}
                  <span className="talk-long">{line.chip}</span>
                  <span className="talk-short">{line.short}</span>
                  {line.from === "claude" ? <span className="talk-arrow">→</span> : null}
                </span>
              </span>
            </span>
          ) : null}
          <span className="talk-agreed">Plan agreed</span>
        </div>
        <Tile agent="codex" status={statusOf("codex")} receiving={line && landed && line.from === "claude" ? `${cycle}-${turn}` : null} />
      </div>

    </div>
  );
}
