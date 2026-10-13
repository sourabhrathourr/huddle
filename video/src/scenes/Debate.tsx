import * as React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { EASE_IN_OUT, cue, enter, mix, rise } from "../lib";

// The heart of it: a real shape of a huddle. A question, a proposal, a rejection with file and line,
// a concession, agreement. The cards are the messages; their words are the ones the site's bench files.

type Who = "you" | "claude" | "codex";
interface Card {
  who: Who;
  name: string;
  verb: string;
  at: number;
  lines: number;
  body: (frame: number) => React.ReactNode;
}

const W = 920;
const LINE = 40;
const GAP = 22;
const TOP = 150;

const Code = ({ children, glow = 0, tint }: { children: React.ReactNode; glow?: number; tint: string }) => (
  <code
    style={{
      padding: "1px 8px",
      borderRadius: 7,
      background: `color-mix(in srgb, ${tint} ${Math.round(mix(0, 16, glow))}%, var(--soft))`,
      color: "var(--anatomy-strong)",
      fontSize: "0.9em",
    }}
  >
    {children}
  </code>
);

export function Debate() {
  const frame = useCurrentFrame();
  const struckAt = cue("debate", "won't");
  const fileAt = cue("debate", "file") - 2;

  const cards: Card[] = [
    {
      who: "you",
      name: "You",
      verb: "ask",
      at: cue("ask", "Retries") - 6,
      lines: 1,
      body: () => <>Retries double-charge a customer now and then. Find out why.</>,
    },
    {
      who: "claude",
      name: "Claude",
      verb: "proposes",
      at: cue("debate", "proposes") - 10,
      lines: 2,
      body: (f) => {
        const struck = rise(f, struckAt, 14);
        return (
          <span style={{ opacity: mix(1, 0.45, struck), textDecoration: struck > 0.5 ? "line-through" : "none", textDecorationColor: "var(--anatomy-mid)", textDecorationThickness: 2 }}>
            Two retries can overlap. Proposal: put a lock around <Code tint="var(--claude)">retry()</Code> in worker.py.
          </span>
        );
      },
    },
    {
      who: "codex",
      name: "Codex",
      verb: "rejects",
      at: cue("debate", "disagrees") - 8,
      lines: 2,
      body: (f) => (
        <>
          Disagree. It isn&apos;t overlap: <Code tint="var(--codex)" glow={rise(f, fileAt, 14)}>runner.py:88</Code> retries a job after a timeout even when it has already committed. A lock won&apos;t stop that.
        </>
      ),
    },
    {
      who: "claude",
      name: "Claude",
      verb: "concedes",
      at: cue("debate", "concedes") - 8,
      lines: 2,
      body: () => (
        <>
          You&apos;re right, lock dropped. <Code tint="var(--claude)">commit()</Code> runs before the ack. Skip the retry once a job is committed?
        </>
      ),
    },
    {
      who: "codex",
      name: "Codex",
      verb: "agrees",
      at: cue("debate", "Together,") - 2,
      lines: 2,
      body: () => <>Agreed: skip the retry once committed. Next: you take runner.py, I take the tests.</>,
    },
  ];

  const heights = cards.map((card) => 92 + card.lines * LINE);
  const tops: number[] = [];
  heights.reduce((y, h, index) => {
    tops[index] = y;
    return y + h + GAP;
  }, TOP);

  // Keep the thread centred on the frame as it grows: each arrival glides it up by half its own height.
  const AGREED_H = 50 + 76;
  const centred = (bottom: number) => (1080 - (bottom - TOP)) / 2 - TOP;
  let offset = centred(tops[0]! + heights[0]!);
  cards.forEach((card, index) => {
    if (index === 0) return;
    offset = mix(offset, centred(tops[index]! + heights[index]!), rise(frame, card.at - 6, 22, EASE_IN_OUT));
  });
  const agreedAt = cue("debate", "better");
  offset = mix(offset, centred(tops[4]! + heights[4]! + AGREED_H), rise(frame, agreedAt - 10, 26, EASE_IN_OUT));
  const agreed = rise(frame, agreedAt - 4, 22);
  const scroll = -offset;

  const intro = rise(frame, 0, 20) * (1 - rise(frame, cards[0]!.at - 16, 14));

  return (
    <div className="scene">
      <div style={{ position: "absolute", top: 440, left: 0, right: 0, textAlign: "center", opacity: intro, transform: `translateY(${mix(14, 0, rise(frame, 0, 20))}px)` }}>
        <h1 style={{ fontSize: 88 }}>
          Now give them <span className="soft">something hard.</span>
        </h1>
      </div>

      <div style={{ position: "absolute", inset: 0, transform: `translateY(${-scroll}px)` }}>
        {cards.map((card, index) => {
          const k = rise(frame, card.at, 20);
          if (k <= 0) return null;
          const x = card.who === "claude" ? 230 : card.who === "codex" ? 1920 - 230 - W : (1920 - W) / 2;
          return (
            <div
              key={index}
              style={{
                position: "absolute",
                top: tops[index],
                left: x,
                width: W,
                height: heights[index],
                padding: "24px 32px",
                border: "1.5px solid var(--hairline)",
                borderRadius: 24,
                background: card.who === "you" ? "var(--anatomy-page)" : "var(--anatomy-card)",
                ...enter(k, 18),
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 14, height: 30, marginBottom: 14 }}>
                <span className={`dot ${card.who}`} />
                <span style={{ color: "var(--anatomy-strong)", fontSize: 24, fontWeight: 600, letterSpacing: "-0.01em" }}>{card.name}</span>
                <span className="mono" style={{ color: "var(--anatomy-muted)", fontSize: 20 }}>
                  {card.verb}
                </span>
                <span className="mono" style={{ marginLeft: "auto", color: "var(--anatomy-muted)", fontSize: 19 }}>
                  #{index + 1}
                </span>
              </div>
              <p style={{ color: "var(--anatomy-strong)", fontSize: 28, lineHeight: `${LINE}px`, letterSpacing: "-0.01em" }}>{card.body(frame)}</p>
            </div>
          );
        })}

        {/* Agreement */}
        <div style={{ position: "absolute", top: tops[4]! + heights[4]! + 50, left: 0, right: 0, display: "flex", justifyContent: "center", ...enter(agreed, 14) }}>
          <span className="pill" style={{ fontSize: 28, padding: "16px 30px", gap: 16 }}>
            <svg width={26} height={26} viewBox="0 0 16 16" fill="none" stroke="var(--anatomy-strong)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3.5 8.5l3 3 6-7" />
            </svg>
            Plan agreed
            <span className="soft" style={{ fontWeight: 400 }}>
              · one bug, one fix
            </span>
          </span>
        </div>
      </div>

      {/* Fade the cards out under the top edge as they scroll away */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 130, background: "linear-gradient(var(--anatomy-page) 35%, transparent)", opacity: interpolate(scroll, [0, 40], [0, 1], { extrapolateRight: "clamp" }) }} />
    </div>
  );
}
