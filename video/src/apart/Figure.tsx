import * as React from "react";
import { translateAlong, type Flat } from "../../../site/components/iso/iso-kit";
import { Dots, Line, Solid } from "../../../site/components/iso/react/draw";
import { CLAUDE_MARK, CODEX_MARK } from "../../../site/components/logos";
import "../../../site/components/bench/bench.css";
import {
  CARDS,
  CARD_HALF,
  CORDS,
  CRT,
  DESKS,
  HEIGHT,
  KEYBOARDS,
  LOOSE,
  P,
  SCREEN,
  STATION,
  TERMINALS,
  WIDTH,
  at,
  clipAbove,
  type Agent,
  type Recess,
} from "./geometry";

export interface ScreenState {
  mode: "brand" | "message";
  status: string; // top-right of the screen
  note?: string; // a line under the logo
  noteOn?: number;
  label?: string; // "⌘C copied" / "⌘V pasted"
  lines?: string[];
  selected?: number; // 0..1, the selection sweeping across the copied text
  typed?: number; // 0..1, how much of the pasted text has appeared
}

export interface CardState {
  who: Agent;
  x: number; // world position of the card's foot, centre of its width
  y: number;
  z: number;
  opacity: number;
  clip: number | null; // the tray top it is rising out of or sinking into
}

export interface FigureState {
  enter: Record<Agent, number>;
  screens: Record<Agent, ScreenState>;
  lamps: Record<Agent, number>;
  plugs: number; // the loose plugs' tips flash when the link is missing
  cards: CardState[];
}

const tenth = (value: number) => Math.round(value * 10) / 10;
const NAMES: Record<Agent, string> = { claude: "CLAUDE CODE", codex: "CODEX" };
const TINT: Record<Agent, string> = { claude: "var(--bn-claude)", codex: "var(--bn-codex)" };

function RecessArt({ recess, well, children }: { recess: Recess; well: string; children?: React.ReactNode }) {
  const id = React.useId();
  return (
    <>
      <clipPath id={id}>
        <path transform={recess.face} d={recess.shape} />
      </clipPath>
      <g clipPath={`url(#${id})`}>
        <path className="iso-top" d={recess.tops} />
        {recess.sides.map((d, shade) => (d ? <path key={shade} className="iso-shade" data-shade={shade} d={d} /> : null))}
        <g transform={recess.back}>
          <path className={well} d={recess.shape} />
          <path className="iso-line" data-tone="faint" d={recess.shape} />
        </g>
        {children}
      </g>
      <g transform={recess.face}>
        <path className="iso-line" data-tone="lo" d={recess.shape} />
      </g>
    </>
  );
}

// The logo on the glass, drawn in the screen's own plane.
function Mark({ agent, cx, z, size }: { agent: Agent; cx: number; z: number; size: number }) {
  const mark = agent === "claude" ? CLAUDE_MARK : CODEX_MARK;
  const k = size / mark.size;
  return (
    <path
      d={mark.d}
      transform={`translate(${tenth(cx - size / 2)} ${tenth(-z - size / 2)}) scale(${k.toFixed(4)})`}
      fill={agent === "claude" ? "#D97757" : "var(--anatomy-hi)"}
      fillRule="evenodd"
    />
  );
}

function Screen({ agent, state }: { agent: Agent; state: ScreenState }) {
  const t = TERMINALS[agent];
  const crt = CRT(t.cx);
  const left = crt.x0 + 4.6;
  const right = crt.x1 - 4.6;
  const row = (z: number) => tenth(-z);
  const lines = state.lines ?? [];
  const total = lines.join("").length;
  let budget = Math.round((state.typed ?? 1) * total);
  return (
    <g>
      <path className="bn-glow" data-who={agent} d={t.glow} style={{ opacity: state.mode === "message" ? 0.16 : 0.08 }} />
      <path className="bn-scan" d={t.scan} />
      <text className="bn-text" data-strong="" x={left} y={row(SCREEN.header)} fontSize={4.2}>
        {NAMES[agent]}
      </text>
      <text className="bn-text" data-dim={state.status === "idle" ? "" : undefined} x={right} y={row(SCREEN.header)} fontSize={4.2} textAnchor="end">
        {state.status}
      </text>
      <path className="iso-line" data-tone="lo" d={`M${left} ${row(SCREEN.rule)}H${right}`} data-free="" />
      {state.mode === "brand" ? (
        <>
          <Mark agent={agent} cx={t.cx} z={40.5} size={state.note ? 16 : 19} />
          {state.note ? (
            <text className="bn-text" data-dim="" x={t.cx} y={row(26.6)} fontSize={4.2} textAnchor="middle" style={{ opacity: state.noteOn ?? 1 }}>
              {state.note}
            </text>
          ) : null}
        </>
      ) : (
        <>
          <text className="bn-text" data-dim="" x={left} y={row(52.6)} fontSize={4.4}>
            {state.label}
          </text>
          {state.selected ? (
            <rect
              x={left - 1.2}
              y={row(47.8)}
              width={tenth((right - left + 2.4) * state.selected)}
              height={15.2}
              rx={1}
              fill={TINT[agent]}
              opacity={0.28}
            />
          ) : null}
          {lines.map((line, index) => {
            const shown = line.slice(0, Math.max(0, budget));
            budget -= line.length;
            return (
              <text key={index} className="bn-text" x={left} y={row(44 - index * 7.2)} fontSize={5}>
                {shown}
              </text>
            );
          })}
        </>
      )}
    </g>
  );
}

function Desk({ agent }: { agent: Agent }) {
  const d = DESKS[agent];
  return (
    <g>
      <path className="iso-halo" d={d.halo} />
      {d.feet.map((parts, index) => (
        <g key={index}>
          {parts.map((paths, part) => (
            <Solid key={part} paths={paths} tone={part ? "mid" : "lo"} />
          ))}
        </g>
      ))}
      <Solid paths={d.slab} tone="mid" inner={<Line d={d.seam} tone="faint" />} />
      <Line d={d.groove} tone="lo" />
      <Line d={d.screwRings} tone="lo" />
      <Dots points={d.screws} size={0.55} />
      <Solid paths={d.plate} tone="lo" crease="none" />
      <Line d={d.plateLine} tone="faint" />
      <Line d={d.plateRule} tone="lo" free />
      <Dots points={d.plateScrews} size={0.45} />
      <Solid paths={d.strip} tone="lo" crease="none" />
      <Line d={d.stripMinor} tone="lo" />
      <Line d={d.stripMajor} tone="mid" />
    </g>
  );
}

function Loose({ agent, flash }: { agent: Agent; flash: number }) {
  const l = LOOSE[agent];
  const [tx, ty] = at(l.tip);
  return (
    <g>
      <g className="iso-wire" data-tone="mid">
        <Line d={l.d} tone="mid" className="bn-cable" />
        <circle className="iso-wire-end" cx={tenth(l.start[0])} cy={tenth(l.start[1])} r={1.1} />
      </g>
      <Solid paths={l.body} tone="mid" />
      <Line d={l.grip} tone="faint" />
      <Line d={l.pins} tone="hi" />
      <Dots points={l.pinEnds as Flat[]} size={0.5} tone="hi" />
      {flash > 0 ? (
        <g opacity={flash}>
          <circle className="bn-pulse-halo" cx={tenth(tx)} cy={tenth(ty)} r={5} style={{ fill: TINT[agent] }} />
          <circle cx={tenth(tx)} cy={tenth(ty)} r={1.6} style={{ fill: TINT[agent] }} />
        </g>
      ) : null}
    </g>
  );
}

function Terminal({ agent, screen, lamp }: { agent: Agent; screen: ScreenState; lamp: number }) {
  const t = TERMINALS[agent];
  return (
    <g>
      <path className="iso-halo" d={t.halo} />
      <Solid paths={t.plinth} tone="lo" />
      <Solid paths={t.shell} tone="mid" inner={<Line d={t.seam} tone="faint" />} />
      <g transform={t.bezel.face}>
        <path className="iso-line" data-tone="faint" d={t.faceLine} />
      </g>
      <RecessArt recess={t.bezel} well="bn-bezel">
        <RecessArt recess={t.crt} well="bn-glass">
          <g transform={t.crt.back}>
            <Screen agent={agent} state={screen} />
          </g>
        </RecessArt>
      </RecessArt>
      <g transform={t.bezel.face}>
        <path className="iso-line" data-tone="lo" d={t.slotFace} />
      </g>
      {t.buttons.map((paths, index) => (
        <Solid key={index} paths={paths} tone="mid" />
      ))}
      <Line d={t.sideVents} tone="faint" />
      <Line d={t.handle} tone="lo" />
      <Line d={t.handleInner} tone="faint" />
      <Line d={t.topVents} tone="faint" />
      <Solid paths={t.tray} tone="mid" />
      <path className="bn-slot" d={t.traySlotFill} />
      <Line d={t.traySlot} tone="lo" />
      <Dots points={t.trayScrews} size={0.45} />
      <Solid paths={t.lampBase} tone="lo" />
      <Solid paths={t.lamp} tone="mid" />
      <path className="bn-lamp" data-who={agent} d={t.lampFill} style={{ opacity: lamp }} />
      <Line d={t.lampLens} tone="faint" />
      <Solid paths={t.boss} tone="mid" />
      <Line d={t.bossRing} tone="lo" />
    </g>
  );
}

function Keyboard({ agent }: { agent: Agent }) {
  const k = KEYBOARDS[agent];
  const cord = CORDS[agent === "claude" ? 0 : 1]!;
  return (
    <g>
      <Solid paths={cord.boss} tone="mid" />
      <Line d={cord.ring} tone="lo" />
      <g className="iso-wire" data-tone="mid">
        <Line d={cord.d} tone="mid" className="bn-cord" />
        {cord.ends.map(([x, y], index) => (
          <circle key={index} className="iso-wire-end" cx={tenth(x)} cy={tenth(y)} r={0.9} />
        ))}
      </g>
      <path className="iso-halo" d={k.halo} />
      <Solid paths={k.base} tone="lo" />
      <Solid paths={k.deck} tone="mid" />
      <Line d={k.keys} tone="lo" />
    </g>
  );
}

function Card({ card, index }: { card: CardState; index: number }) {
  const c = CARDS[card.who];
  const id = `apart-card-${index}`;
  return (
    <g opacity={card.opacity}>
      {card.clip !== null ? (
        <clipPath id={id}>
          <path d={clipAbove(card.x, card.y, card.clip)} />
        </clipPath>
      ) : null}
      <g clipPath={card.clip !== null ? `url(#${id})` : undefined}>
        <g transform={translateAlong(P, [card.x, card.y, card.z])} data-who={card.who}>
          <Solid paths={c.body} tone="hi" crease="lo" lit />
          <Line d={c.rules} tone="faint" free />
          <Solid paths={c.tab} tone="hi" className="bn-tab" />
        </g>
      </g>
    </g>
  );
}

// One agent's whole station: desk, cable, terminal, keyboard. It arrives as one piece.
function Station({ agent, state }: { agent: Agent; state: FigureState }) {
  const k = state.enter[agent];
  if (k <= 0) return null;
  return (
    <g opacity={k} transform={`translate(0 ${tenth((1 - k) * 16)})`}>
      <g transform={translateAlong(P, [STATION[agent][0], STATION[agent][1], 0])}>
      <Desk agent={agent} />
      <Loose agent={agent} flash={state.plugs} />
      <Terminal agent={agent} screen={state.screens[agent]} lamp={state.lamps[agent]} />
      <Keyboard agent={agent} />
      </g>
    </g>
  );
}

export function ApartFigure({ state }: { state: FigureState }) {
  // Cards that have fallen below the desks' top are drawn first, so the desks cover them.
  const below = state.cards.filter((card) => card.z < 0);
  const above = state.cards.filter((card) => card.z >= 0);
  return (
    <div className="bn">
      <svg className="iso-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ overflow: "visible" }}>
        {below.map((card, index) => (
          <Card key={`b${index}`} card={card} index={index + 10} />
        ))}
        <Station agent="claude" state={state} />
        <Station agent="codex" state={state} />
        {above.map((card, index) => (
          <Card key={`a${index}`} card={card} index={index} />
        ))}
      </svg>
    </div>
  );
}

export { CARD_HALF };
