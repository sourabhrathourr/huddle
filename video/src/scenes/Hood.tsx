import * as React from "react";
import { useCurrentFrame } from "remotion";
import { BenchArt } from "../../../site/components/bench/art";
import { apply, find, type Nodes } from "../../../site/components/bench/live";
import { STARTS, poseAt } from "../../../site/components/bench/model";
import { HEIGHT, WIDTH } from "../../../site/components/bench/view";
import "../../../site/components/bench/bench.css";
import { FPS, cue, enter, rise } from "../lib";

// Under the hood: the site's bench, posed frame by frame from the same model the site plays.
const SPEED = 1.15;

function Bench({ time }: { time: number }) {
  const root = React.useRef<HTMLDivElement>(null);
  const nodes = React.useRef<Nodes | null>(null);
  React.useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    nodes.current ??= find(element);
    apply(element, nodes.current, poseAt(time));
  }, [time]);
  return (
    <div ref={root} className="bn">
      <div className="bn-card" style={{ height: 830, padding: "20px 36px 56px", borderRadius: 28, borderWidth: 1.5, display: "grid", placeItems: "center" }}>
        <svg className="iso-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} focusable="false" style={{ width: 1240, height: "auto" }}>
          <BenchArt />
        </svg>
      </div>
    </div>
  );
}

export function Hood() {
  const frame = useCurrentFrame();
  const time = STARTS[1]! + (frame / FPS) * SPEED;
  const tags = [
    { text: "No server", at: cue("hood", "server.") - 6 },
    { text: "No account", at: cue("hood", "account.") - 6 },
    { text: "No telemetry", at: cue("hood", "telemetry.") - 6 },
  ];
  const db = rise(frame, cue("hood", "SQLite") - 8, 18);

  return (
    <div className="scene">
      <div style={{ position: "absolute", left: 160, top: 96, right: 160, display: "flex", alignItems: "flex-end", justifyContent: "space-between", ...enter(rise(frame, 0, 20)) }}>
        <h2 style={{ fontSize: 58 }}>
          Under the hood, <span className="soft">it&apos;s simple.</span>
        </h2>
        <div style={{ display: "flex", gap: 14 }}>
          {tags.map((tag) => (
            <span key={tag.text} className="pill" style={{ fontSize: 23, ...enter(rise(frame, tag.at, 16), 10) }}>
              {tag.text}
            </span>
          ))}
        </div>
      </div>

      <div style={{ position: "absolute", left: 160, right: 160, top: 196, ...enter(rise(frame, 4, 26), 24) }}>
        <Bench time={time} />
        <div style={{ position: "absolute", left: 32, bottom: 30, ...enter(db, 10) }}>
          <span className="pill mono" style={{ fontSize: 22 }}>
            <span style={{ color: "var(--anatomy-muted)" }}>every message, in order</span>~/.huddle/huddle.db
          </span>
        </div>
      </div>
    </div>
  );
}
