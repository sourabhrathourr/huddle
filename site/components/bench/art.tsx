import * as React from "react";
import type { Flat } from "../iso/iso-kit";
import { Dots, FaceText, Line, Solid } from "../iso/react/draw";
import {
  ARM_ART,
  BENCH_ART,
  BULKHEAD_ART,
  CABLE_ART,
  CARDS,
  CARRIAGE_ART,
  CORDS,
  CRT,
  GANTRY_ART,
  GRIPPER_ART,
  HOIST_ART,
  KEYBOARDS,
  LEDGER_ART,
  RIDER_ART,
  SCREEN_ROWS,
  SEATED,
  TERMINALS,
  type Recess,
} from "./geometry";
import type { Agent, Who } from "./model";
import { translateAlong } from "../iso/iso-kit";
import { LEDGER_FLOOR, P } from "./view";

const tenth = (value: number) => Math.round(value * 10) / 10;

function Ends({ points, size = 1.1 }: { points: Flat[]; size?: number }) {
  return (
    <>
      {points.map(([x, y], index) => (
        <circle key={index} className="iso-wire-end" cx={tenth(x)} cy={tenth(y)} r={size} />
      ))}
    </>
  );
}

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

// ---------------------------------------------------------------- pieces

function Bench() {
  const b = BENCH_ART;
  return (
    <g key="bench">
      <path className="iso-halo" d={b.halo} />
      {b.feet.map((parts, index) => (
        <g key={index}>
          {parts.map((paths, part) => (
            <Solid key={part} paths={paths} tone={part ? "mid" : "lo"} />
          ))}
        </g>
      ))}
      <Solid paths={b.slab} tone="mid" inner={<Line d={b.seam} tone="faint" />} />
      <Line d={b.groove} tone="lo" />
      <Line d={b.screwRings} tone="lo" />
      <Dots points={b.screws} size={0.55} />
      <Solid paths={b.plate} tone="lo" crease="none" />
      <Line d={b.plateLine} tone="faint" />
      <Line d={b.plateRule} tone="lo" free />
      <Dots points={b.plateScrews} size={0.45} />
      <Solid paths={b.strip} tone="lo" crease="none" />
      <Line d={b.stripMinor} tone="lo" />
      <Line d={b.stripMajor} tone="mid" />
    </g>
  );
}

function Gantry() {
  const g = GANTRY_ART;
  return (
    <g key="gantry">
      {g.posts.map((post, index) => (
        <g key={index}>
          <Solid paths={post.base} tone="lo" />
          <Dots points={post.baseScrews} size={0.45} />
          <Solid paths={post.post} tone="mid" inner={<Line d={post.postSeam} tone="faint" />} />
          <Solid paths={post.collar} tone="mid" />
          <Dots points={[post.collarScrew]} size={0.5} />
        </g>
      ))}
      <Solid paths={g.rail} tone="mid" />
      <Line d={g.railMinor} tone="lo" />
      <Line d={g.railMajor} tone="mid" />
      <Dots points={g.railScrews} size={0.5} />
      {g.stops.map((paths, index) => (
        <Solid key={index} paths={paths} tone="mid" />
      ))}
      <Dots points={g.stopScrews} size={0.4} />
    </g>
  );
}

function Screen({ agent }: { agent: Agent }) {
  const t = TERMINALS[agent];
  const crt = CRT(t.cx);
  const left = crt.x0 + 4.6;
  const right = crt.x1 - 4.6;
  const row = (z: number) => tenth(-z);
  return (
    <g data-part={`${agent}-screen`}>
      <path className="bn-glow" data-who={agent} d={t.glow} />
      <path className="bn-scan" d={t.scan} />
      <text className="bn-text" data-strong="" x={left} y={row(SCREEN_ROWS.header)} fontSize={4.2}>
        {agent === "claude" ? "CLAUDE CODE" : "CODEX"}
      </text>
      <text className="bn-text" data-part={`${agent}-status`} x={right} y={row(SCREEN_ROWS.header)} fontSize={4.2} textAnchor="end">
        idle
      </text>
      <path className="iso-line" data-tone="lo" d={`M${left} ${row(SCREEN_ROWS.rule)}H${right}`} data-free="" />
      <text className="bn-text" data-part={`${agent}-direction`} data-dim="" x={left} y={row(SCREEN_ROWS.direction)} fontSize={4.4}>
        huddle 1 · joined
      </text>
      {SCREEN_ROWS.lines.map((z, index) => (
        <text key={index} className="bn-text" data-part={`${agent}-line-${index}`} x={left} y={row(z)} fontSize={5}>
          {index === 0 ? "ready." : ""}
        </text>
      ))}
    </g>
  );
}

function Terminal({ agent }: { agent: Agent }) {
  const t = TERMINALS[agent];
  return (
    <g data-part={`${agent}-terminal`}>
      <path className="iso-halo" d={t.halo} />
      <Solid paths={t.plinth} tone="lo" />
      <Solid paths={t.shell} tone="mid" inner={<Line d={t.seam} tone="faint" />} />
      <g transform={t.bezel.face}>
        <path className="iso-line" data-tone="faint" d={t.faceLine} />
      </g>
      <RecessArt recess={t.bezel} well="bn-bezel">
        <RecessArt recess={t.crt} well="bn-glass">
          <g transform={t.crt.back}>
            <Screen agent={agent} />
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
      <path className="bn-lamp" data-who={agent} data-part={`${agent}-lamp`} d={t.lampFill} />
      <Line d={t.lampLens} tone="faint" />
      <Solid paths={t.boss} tone="mid" />
      <Line d={t.bossRing} tone="lo" />
      <Solid paths={t.cordBoss} tone="mid" />
      <Line d={t.cordRing} tone="lo" />
    </g>
  );
}

function Keyboard({ agent }: { agent: Agent }) {
  const k = KEYBOARDS[agent];
  return (
    <g>
      <path className="iso-halo" d={k.halo} />
      <Solid paths={k.base} tone="lo" />
      <Solid paths={k.deck} tone="mid" />
      <Line d={k.keys} tone="lo" />
    </g>
  );
}

function Card({ who, part, lit = false }: { who: Who; part?: string; lit?: boolean }) {
  const card = CARDS[who];
  return (
    <g data-part={part} data-who={who}>
      <Solid paths={card.body} tone="hi" crease="lo" lit={lit} />
      <Line d={card.rules} tone="faint" free />
      <Solid paths={card.tab} tone="hi" className="bn-tab" />
    </g>
  );
}

// The moving card with all three tabs; the live figure shows the sender's.
function MovingCard({ slot }: { slot: "top" | "stack" }) {
  return (
    <g data-part={`card-${slot}`} style={{ display: "none" }}>
      <clipPath id={`bn-rise-${slot}`}>
        <path data-part={`card-clip-${slot}`} d="M-9999 -9999H9999V9999H-9999Z" />
      </clipPath>
      <g clipPath={`url(#bn-rise-${slot})`}>
        <g data-part={`card-move-${slot}`}>
          {(["you", "claude", "codex"] as Who[]).map((who) => (
            <g key={who} data-show={who} className="bn-variant">
              <Card who={who} lit />
            </g>
          ))}
        </g>
      </g>
    </g>
  );
}

function Ledger() {
  const l = LEDGER_ART;
  return (
    <g key="ledger">
      <path className="iso-halo" d={l.halo} />
      <Solid paths={l.base} tone="lo" />
      <Dots points={l.baseScrews} size={0.45} />
      <Solid paths={l.back} tone="mid" />
      <Solid paths={l.left} tone="mid" />
      <Solid paths={l.floor} tone="lo" crease="none" />
      <Line d={l.guides} tone="faint" />
      {SEATED.map((seat, index) => (
        <g key={index} data-part={`seated-${index}`} transform={translateAlong(P, [seat.x, 0, LEDGER_FLOOR])} style={{ opacity: 0 }}>
          <Card who={seat.who} />
        </g>
      ))}
      <MovingCard slot="stack" />
      <Solid paths={l.right} tone="mid" />
      <Solid paths={l.front} tone="mid" inner={<Line d={l.frontSeam} tone="faint" />} />
      <Line d={l.lanes} tone="lo" />
      <Line d={l.ticks} tone="lo" />
      <Line d={l.zero} tone="hi" />
      <Dots points={l.wallScrews} size={0.45} />
      {(["claude", "codex"] as Agent[]).map((agent) => (
        <g key={agent} data-part={`rider-${agent}`} transform={translateAlong(P, [-35, 0, 0])}>
          <Solid paths={RIDER_ART[agent].body} tone="hi" className="bn-rider" />
          <g className="bn-rider-top" data-who={agent}>
            <path d={RIDER_ART[agent].top} />
          </g>
          <Line d={RIDER_ART[agent].tick} tone="hi" />
        </g>
      ))}
      <g transform={l.labelFace}>
        <path className="bn-plate" d={l.label} />
        <path className="iso-line" data-tone="lo" d={l.label} />
        <path className="iso-line" data-tone="faint" d={l.labelInner} />
      </g>
      <FaceText transform={l.labelText} size={4} tone="mid" anchor="middle">
        huddle.db
      </FaceText>
      {l.ports.map((port, index) => (
        <g key={index}>
          <Solid paths={port.boss} tone="mid" />
          <Line d={port.ring} tone="lo" />
        </g>
      ))}
      <Dots points={l.portScrews} size={0.4} />
    </g>
  );
}

function Cables() {
  return (
    <g key="cables">
      {CORDS.map((cord, index) => (
        <g key={index} className="iso-wire" data-tone="mid">
          <Line d={cord.d} tone="mid" className="bn-cord" />
          <Ends points={cord.ends} size={0.9} />
        </g>
      ))}
      {CABLE_ART.map((cable) => (
        <g key={cable.who} className="iso-wire" data-tone="mid" data-part={`cable-${cable.who}`}>
          <Line d={cable.d} tone="mid" className="bn-cable" />
          <Line d={cable.d} tone="lit" className="bn-cable-live" />
          <Ends points={cable.ends} size={1.1} />
        </g>
      ))}
      {(["a", "b"] as const).map((key) => (
        <g key={key} data-part={`pulse-${key}`} style={{ display: "none" }}>
          <circle className="bn-pulse-halo" r={4.2} />
          <circle className="bn-pulse" r={1.9} />
        </g>
      ))}
    </g>
  );
}

function Bulkhead() {
  const b = BULKHEAD_ART;
  return (
    <g key="bulkhead">
      <path className="iso-halo" d={b.halo} />
      <Solid paths={b.body} tone="mid" />
      <Line d={b.topLine} tone="faint" />
      <Dots points={b.screws} size={0.45} />
      <Line d={b.socket} tone="lo" />
      <path className="bn-socket" data-part="socket" d={b.socketFill} />
      <Line d={b.socketInner} tone="mid" />
    </g>
  );
}

function Carrier() {
  return (
    <g key="carrier">
      <MovingCard slot="top" />
      <path className="iso-line bn-hoist-line" data-tone="hi" data-part="hoist-line" d="" />
      <g data-part="gripper">
        <Solid paths={GRIPPER_ART.body} tone="mid" />
        <Line d={GRIPPER_ART.jaw} tone="lo" />
        <Dots points={[GRIPPER_ART.pin]} size={0.5} tone="hi" />
      </g>
    </g>
  );
}

function Head() {
  const c = CARRIAGE_ART;
  const a = ARM_ART;
  const h = HOIST_ART;
  return (
    <g key="head" data-part="head">
      <path className="iso-halo bn-soft" d={c.halo} />
      {c.bushes.map((paths, index) => (
        <Solid key={index} paths={paths} tone="mid" />
      ))}
      <Solid paths={c.block} tone="mid" inner={<Line d={c.blockSeam} tone="faint" />} />
      <Line d={c.blockLine} tone="faint" />
      <Dots points={c.blockScrews} size={0.45} />
      <Solid paths={c.knob} tone="mid" />
      <Line d={c.knobRing} tone="lo" />
      <Line d={c.index} tone="lit" />
      <Solid paths={h.nose} tone="mid" />
      <Solid paths={h.housing} tone="mid" inner={<Line d={h.band} tone="faint" />} />
      <Solid paths={a.arm} tone="mid" />
      <Line d={a.armLine} tone="faint" />
      <Dots points={a.armScrews} size={0.45} />
    </g>
  );
}

export const LABEL =
  "A workbench with two terminals, Claude Code on the left and Codex on the right, and a card file between them labelled huddle.db. Each message is printed as a card in the sender's tray; a gantry crane on a rail at the back lifts it and files it in the next slot. A pulse runs down the cable to each reader, its lamp lights and its cursor rider moves along the front of the file to the message it has read. A bulkhead at the front of the bench is where you plug in to watch and to steer.";

export function BenchArt() {
  return (
    <g key="art">
      <Bench />
      <Gantry />
      <Terminal agent="claude" />
      <Ledger />
      <Terminal agent="codex" />
      <Bulkhead />
      <Cables />
      <Keyboard agent="claude" />
      <Keyboard agent="codex" />
      <Carrier />
      <Head />
    </g>
  );
}
