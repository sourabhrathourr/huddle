import type * as React from "react";
import { useCurrentFrame } from "remotion";
import { ApartFigure, type CardState, type FigureState, type ScreenState } from "../apart/Figure";
import { CARD_H, CARD_SEAT, CASE_TOP, STATION, TRAY_H, TRAY_Y, type Agent } from "../apart/geometry";
import { EASE_IN_OUT, cue, enter, mix, rise } from "../lib";

// Two strong agents, each at its own desk, with nothing between them but a gap and two plugs that reach for
// nothing. You carry their messages across by hand: copied off one screen, pasted onto the other. The third
// one never arrives: it falls into the gap.

const TRAY_TOP = CASE_TOP + TRAY_H;
const LIFT = 28; // how high you lift a card over the tray before carrying it
const ARC = 34; // how much higher it rides in the middle of the carry

interface Trip {
  from: Agent;
  lines: [string, string];
  copy: number; // frame the text is copied (the card rises)
  paste: number | null; // frame it lands; null if it is lost
  lost?: number;
}

// Where a card is during a trip, `frame` frames in.
function cardOf(trip: Trip, frame: number): CardState | null {
  const other: Agent = trip.from === "claude" ? "codex" : "claude";
  const [fx, fy] = [STATION[trip.from][0], STATION[trip.from][1] + TRAY_Y];
  const [tx, ty] = [STATION[other][0], STATION[other][1] + TRAY_Y];
  const along = (k: number) => ({ x: mix(fx, tx, k), y: mix(fy, ty, k) });
  const up = rise(frame, trip.copy - 6, 12);
  if (up <= 0) return null;
  const hidden = CARD_SEAT - CARD_H; // all the way down inside the tray
  const top = CARD_SEAT + LIFT;
  const carryAt = trip.copy + 6;
  // A delivered card lands on its paste; a lost one is timed to be halfway over the gap when it slips
  // (the ease-in-out curve passes its halfway mark at 48% of its time).
  const span = trip.paste !== null ? trip.paste - carryAt - 8 : Math.round(((trip.lost ?? carryAt + 24) - carryAt) / 0.48);
  const across = rise(frame, carryAt, span, EASE_IN_OUT);
  const height = (k: number) => top + ARC * Math.sin(Math.PI * k);

  // Lost: it slips out of your hands partway over the gap and drops out of sight.
  if (trip.paste === null && trip.lost !== undefined && frame >= trip.lost) {
    const at = rise(trip.lost, carryAt, span, EASE_IN_OUT);
    const fall = rise(frame, trip.lost, 26, (t) => t * t);
    const drift = along(at + 0.06 * rise(frame, trip.lost, 26));
    return {
      who: trip.from,
      ...drift,
      z: mix(height(at), -160, fall),
      opacity: 1 - rise(frame, trip.lost + 12, 14),
      clip: null,
    };
  }

  // Pasted: it drops down into the other terminal's tray.
  const down = trip.paste === null ? 0 : rise(frame, trip.paste - 8, 12, EASE_IN_OUT);
  if (down >= 1) return null;
  if (down > 0) return { who: trip.from, ...along(1), z: mix(top, hidden, down), opacity: 1, clip: TRAY_TOP };

  // Copied: it rises out of the sender's tray, is lifted clear, then carried over in an arc.
  if (up < 1) return { who: trip.from, ...along(0), z: mix(hidden, CARD_SEAT, up), opacity: 1, clip: TRAY_TOP };
  const z = across > 0 ? height(across) : CARD_SEAT + LIFT * rise(frame, trip.copy + 4, 4);
  return { who: trip.from, ...along(across), z, opacity: 1, clip: null };
}

export function Apart() {
  const frame = useCurrentFrame();

  // The headline builds phrase by phrase; the earlier phrases go soft as the next arrives.
  const lines: { text: string; at: number }[] = [
    { text: "Two of the best coding agents.", at: cue("open", "two") },
    { text: "Different labs.", at: cue("open", "labs.") - 6 },
    { text: "Different thinking.", at: cue("open", "differently.") - 6 },
    { text: "Different mistakes.", at: cue("open", "mistakes.") - 8 },
  ];
  const problemAt = cue("problem", "But");
  const talkAt = cue("problem", "talk");
  const messengerAt = cue("problem", "become") - 8;

  // Headlines hand over one at a time: the old line lifts away and is fully gone before the next rises in.
  const LEAVE = 10;
  const stage = (inAt: number | null, outAt: number | null): React.CSSProperties => {
    const k = inAt === null ? 1 : rise(frame, inAt, 18);
    const out = outAt === null ? 0 : rise(frame, outAt - LEAVE - 2, LEAVE);
    const soft = Math.max(1 - k, out);
    return {
      position: "absolute",
      left: 0,
      right: 0,
      opacity: k * (1 - out),
      transform: `translateY(${(mix(14, 0, k) - 12 * out).toFixed(2)}px)`,
      filter: soft > 0 ? `blur(${(soft * 6).toFixed(2)}px)` : undefined,
    };
  };

  const copies = [cue("problem", "Copy."), cue("problem", "Copy.", 1)];
  const pastes = [cue("problem", "Paste."), cue("problem", "Paste.", 1)];
  const trips: Trip[] = [
    { from: "claude", lines: ["lock retry() so", "two can't overlap?"], copy: copies[0]!, paste: pastes[0]! },
    { from: "codex", lines: ["no: it retries", "committed jobs."], copy: copies[1]!, paste: pastes[1]! },
    { from: "claude", lines: ["then skip it once", "a job commits…"], copy: cue("problem", "something") - 4, paste: null, lost: cue("problem", "lost") - 4 },
  ];

  // What each screen shows: its logo; "no link" once you hear they can't talk; then the copied and pasted text.
  const noLink = rise(frame, talkAt, 14);
  const screens: Record<Agent, ScreenState> = {
    claude: { mode: "brand", status: noLink > 0.5 ? "no link" : "ready", note: noLink > 0 ? "no link to Codex" : undefined, noteOn: noLink },
    codex: { mode: "brand", status: noLink > 0.5 ? "no link" : "ready", note: noLink > 0 ? "no link to Claude" : undefined, noteOn: noLink },
  };
  const lamps: Record<Agent, number> = { claude: 0, codex: 0 };
  for (const trip of trips) {
    const other: Agent = trip.from === "claude" ? "codex" : "claude";
    if (frame >= trip.copy - 4) {
      screens[trip.from] = { mode: "message", status: "no link", label: "⌘C  copied", lines: trip.lines, selected: rise(frame, trip.copy - 4, 6) };
      lamps[trip.from] = 0;
    }
    if (trip.paste !== null && frame >= trip.paste - 2) {
      screens[other] = { mode: "message", status: "no link", label: "⌘V  pasted", lines: trip.lines, typed: rise(frame, trip.paste - 2, 10) };
      lamps[other] = 1 - rise(frame, trip.paste + 16, 20);
    }
  }
  const lost = trips[2]!;
  if (lost.lost !== undefined && frame >= lost.lost + 14) screens.codex = { ...screens.codex, status: "waiting" };

  // The two plugs flash twice when you hear they can't talk: each reaching for a socket that isn't there.
  const blink = (at: number) => Math.sin(Math.PI * Math.min(1, Math.max(0, (frame - at) / 16)));
  const plugs = Math.max(blink(talkAt + 2), blink(talkAt + 22));

  const cards = trips.map((trip) => cardOf(trip, frame)).filter((card): card is CardState => card !== null);

  const state: FigureState = {
    enter: { claude: rise(frame, cue("open", "Claude") - 4, 26), codex: rise(frame, cue("open", "Codex") - 2, 26) },
    screens,
    lamps,
    plugs,
    cards,
  };

  return (
    <div className="scene">
      {/* Headline: the open builds, then gives way to the problem */}
      <div style={{ position: "absolute", top: 130, left: 0, right: 0, textAlign: "center" }}>
        <h1 style={{ fontSize: 72, ...stage(lines[0]!.at - 4, lines[1]!.at - 4) }}>{lines[0]!.text}</h1>
        {/* The three "Different" phrases build on one line (each phrase brings itself in); earlier ones soften. */}
        <h1 style={{ fontSize: 72, ...stage(null, problemAt - 2) }}>
          {lines.slice(1).map((line, index, rest) => {
            const k = rise(frame, line.at - 4, 18);
            const next = rest[index + 1];
            const soft = next ? rise(frame, next.at - 4, 18) : 0;
            return (
              <span
                key={line.text}
                style={{
                  ...enter(k),
                  display: "inline-block",
                  marginRight: 22,
                  color: `color-mix(in srgb, var(--anatomy-muted) ${Math.round(soft * 100)}%, var(--anatomy-strong))`,
                }}
              >
                {line.text}
              </span>
            );
          })}
        </h1>
        <h1 style={{ fontSize: 72, ...stage(problemAt - 2, messengerAt) }}>But they can&apos;t talk to each other.</h1>
        <h1 style={{ fontSize: 72, ...stage(messengerAt, null) }}>
          So you become <span className="soft">the messenger.</span>
        </h1>
      </div>

      <div style={{ position: "absolute", left: 110, right: 110, top: 205 }}>
        <ApartFigure state={state} />
      </div>
    </div>
  );
}
