import {
  cameraOf,
  circleRing,
  corners,
  cylinder,
  fitProjection,
  haloOf,
  insetPlan,
  iso,
  onTop,
  pathOf,
  planOutline,
  ring,
  roundedPlan,
  sideMatrix,
  sideRing,
  sideSeam,
  slabOf,
  topTicks,
  boxCorners,
  type Flat,
  type Plan,
  type Point3,
} from "../../../site/components/iso/iso-kit";

// The opening figure: the bench's two terminals before huddle, each on its own small desk with a gap between.
// Each has a cable that ends in a plug going nowhere. You carry message cards across the gap by hand.
// World units match the bench (about 1 px of the real thing); x runs along the desks, y toward you, z up.

export type Agent = "claude" | "codex";
export const WIDTH = 1000;
export const HEIGHT = 470;
export const AZIMUTH = 60;

// Each station is built around its own origin and placed at STATION. The two sit along the one world
// direction that this camera draws level, (cos 30°, -sin 30°), so they read side by side on screen.
const SPREAD = 178;
export const STATION = {
  claude: [-SPREAD * Math.cos(Math.PI / 6), SPREAD * Math.sin(Math.PI / 6)],
  codex: [SPREAD * Math.cos(Math.PI / 6), -SPREAD * Math.sin(Math.PI / 6)],
} as const satisfies Record<Agent, [number, number]>;
export const desk = (_agent: Agent): Plan => ({ x: -100, y: -88, w: 200, d: 170, r: 9 });
export const DESK_H = 9;
export const FOOT_H = 6;

export const TERM_X = { claude: 0, codex: 0 } as const; // within each station
export const CASE_W = 90;
export const CASE_Y = -52;
export const CASE_D = 62;
export const FRONT = CASE_Y + CASE_D;
export const CASE_TOP = 80;
export const PLINTH_H = 4;
export const TRAY_H = 5;
export const TRAY_Y = CASE_Y + CASE_D / 2; // the tray sits mid-depth on the case top
export const CARD_SEAT = CASE_TOP + 1; // a seated card's bottom
export const KEYS_Y = 30;

// Message cards, the same as the bench's: thin in x, standing in the y-z plane.
export const CARD_T = 1.6;
export const CARD_HALF = 16;
export const CARD_H = 30;
export const TAB_H = 3.2;
export const TAB_D = 5.5;
export const TAB_Y = { claude: 3.4, codex: 9.6 } as const;

// The loose cables: out of each terminal's inner side, along the desk, ending in a plug at the desk's edge.
export const CABLE_Y = 46;
export const PLUG_LEN = 11;

const placed = (agent: Agent, points: Point3[]): Point3[] => points.map(([x, y, z]) => [x + STATION[agent][0], y + STATION[agent][1], z]);
export const P = fitProjection(
  (["claude", "codex"] as Agent[]).flatMap((agent) => [
    ...placed(agent, boxCorners(desk(agent), -DESK_H - FOOT_H, 0)),
    ...placed(agent, boxCorners({ x: -45, y: CASE_Y, w: 90, d: CASE_D, r: 0 }, 0, CASE_TOP + CARD_H + 40)),
  ]),
  WIDTH,
  HEIGHT,
  { pad: 16, azimuth: AZIMUTH },
);

export const at = (point: Point3): Flat => iso(point, P);
const solid = (plan: Plan, z: number, h: number, steps = 6, bevel = 0) => slabOf(plan, z, h, P, steps, bevel);
const cyl = (cx: number, cy: number, r: number, z: number, h: number, steps = 32) => cylinder(cx, cy, r, z, h, P, steps);
const join = (paths: string[]) => paths.filter(Boolean).join("");
const segment = (a: Point3, b: Point3) => pathOf([at(a), at(b)]);

// A face plane: maps local (x, -z) onto the vertical face at y.
export const planeOf = (y: number) => sideMatrix([0, y], 0, P, "left");
const flatShape = (x0: number, z0: number, x1: number, z1: number, r: number, steps = 6) =>
  pathOf(roundedPlan({ x: x0, y: z0, w: x1 - x0, d: z1 - z0, r }, steps).map(([u, z]) => [u, -z] as Flat), true);

// ---------------------------------------------------------------- recesses (the bezel and the CRT)

export interface Window {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  r: number;
  depth: number;
}

export interface Recess {
  shape: string;
  face: string;
  back: string;
  tops: string;
  sides: string[];
}

function recessOf({ x0, x1, z0, z1, r, depth }: Window, y: number): Recess {
  const outline = roundedPlan({ x: x0, y: z0, w: x1 - x0, d: z1 - z0, r }, 6);
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const { sinA } = cameraOf(P);
  const tops: string[] = [];
  const sides: string[][] = [[], [], [], []];
  outline.forEach(([ax, az], index) => {
    const [bx, bz] = outline[(index + 1) % outline.length]!;
    const length = Math.hypot(bx - ax, bz - az) || 1;
    let [nx, nz] = [(bz - az) / length, -(bx - ax) / length];
    if (nx * (cx - (ax + bx) / 2) + nz * (cz - (az + bz) / 2) < 0) [nx, nz] = [-nx, -nz];
    if (nx <= 0 && nz <= 0) return;
    const quad = pathOf([at([ax, y, az]), at([bx, y, bz]), at([bx, y - depth, bz]), at([ax, y - depth, az])], true);
    if (nz >= nx) tops.push(quad);
    else sides[Math.min(3, Math.max(0, Math.floor(((nx * -sinA + 1) / 2) * 4)))]!.push(quad);
  });
  return { shape: flatShape(x0, z0, x1, z1, r), face: planeOf(y), back: planeOf(y - depth), tops: tops.join(""), sides: sides.map((list) => list.join("")) };
}

export const BEZEL = (cx: number): Window => ({ x0: cx - 38, x1: cx + 38, z0: 17, z1: 74, r: 5, depth: 1.6 });
export const CRT = (cx: number): Window => ({ x0: cx - 33, x1: cx + 33, z0: 22, z1: 70, r: 7, depth: 3 });

// ---------------------------------------------------------------- desks

function deskArt(agent: Agent) {
  const plan = desk(agent);
  const screws = corners(plan, 9);
  const plate: Plan = { x: plan.x + 14, y: plan.y + plan.d - 24, w: 50, d: 13, r: 2 };
  const strip: Plan = { x: plan.x + 76, y: plan.y + plan.d - 12, w: 110, d: 6, r: 1 };
  const ticks = topTicks(strip.x + 4, strip.x + strip.w - 4, 5, 5, strip.y + 0.8, 0.6, [1.8, 3.4], P);
  return {
    halo: haloOf(plan, -DESK_H - FOOT_H, DESK_H, P),
    feet: corners(plan, 22).map(([x, y]) => [cyl(x, y, 7.4, -DESK_H - FOOT_H, 1.8), cyl(x, y, 5.6, -DESK_H - FOOT_H + 1.8, FOOT_H - 1.8)]),
    slab: solid(plan, -DESK_H, DESK_H, 10, 1.6),
    seam: sideSeam(plan, -DESK_H + 3.2, P, 10),
    groove: planOutline(insetPlan(plan, 5), 0, P, 10),
    screwRings: join(screws.map(([x, y]) => ring(x, y, 2.1, 0, P, 16))),
    screws: screws.map(([x, y]) => at([x, y, 0])),
    plate: solid(plate, 0, 0.8, 3),
    plateLine: planOutline(insetPlan(plate, 1.5), 0.8, P, 3),
    plateRule: join([0, 1, 2].map((row) => onTop([[plate.x + 8, plate.y + 3.4 + row * 2.4], [plate.x + [36, 27, 40][row]!, plate.y + 3.4 + row * 2.4]], 0.8, P))),
    plateScrews: [at([plate.x + 3.6, plate.y + plate.d / 2, 0.8]), at([plate.x + plate.w - 3.6, plate.y + plate.d / 2, 0.8])],
    strip: solid(strip, 0, 0.6, 3),
    stripMinor: ticks.minor,
    stripMajor: ticks.major,
  };
}

export const DESKS = { claude: deskArt("claude"), codex: deskArt("codex") };

// ---------------------------------------------------------------- terminals

export const SCREEN = { header: 63.6, rule: 59.6 } as const;
export const LAMP = (agent: Agent): [number, number] => [TERM_X[agent] + (agent === "claude" ? 32 : -32), CASE_Y + 12];
// The cable leaves from the terminal's front, on the side that faces the gap.
export const BOSS_X = (agent: Agent) => TERM_X[agent] + (agent === "claude" ? 37 : -37);

function terminal(agent: Agent) {
  const cx = TERM_X[agent];
  const plan: Plan = { x: cx - CASE_W / 2, y: CASE_Y, w: CASE_W, d: CASE_D, r: 6 };
  const tray: Plan = { x: cx - 6, y: TRAY_Y - CARD_HALF - 3, w: 12, d: CARD_HALF * 2 + 6, r: 2 };
  const slot: Plan = { x: cx - 1.6, y: TRAY_Y - CARD_HALF - 1.2, w: 3.2, d: CARD_HALF * 2 + 2.4, r: 1 };
  const [lx, ly] = LAMP(agent);
  const boss = BOSS_X(agent);
  const crt = CRT(cx);
  const mirror = agent === "claude" ? -1 : 1;
  const scan: string[] = [];
  for (let z = crt.z0 + 1.4; z < crt.z1; z += 1.8) scan.push(`M${crt.x0} ${(-z).toFixed(1)}H${crt.x1}`);
  const handle: Plan = { x: cx - 30, y: CASE_Y + 3, w: 60, d: 7, r: 3.5 };
  const side = plan.x + plan.w;
  const vents: string[] = [];
  for (let y = CASE_Y + 10; y <= CASE_Y + 46; y += 3.4) {
    vents.push(pathOf(roundedPlan({ x: y - 0.8, y: CASE_TOP - 40, w: 1.6, d: 28, r: 0.8 }, 4).map(([u, z]) => at([side, u, z])), true));
  }
  return {
    cx,
    halo: haloOf(plan, 0, 10, P),
    plinth: solid(insetPlan(plan, 3), 0, PLINTH_H, 6),
    shell: solid(plan, PLINTH_H, CASE_TOP - PLINTH_H, 8, 1.6),
    seam: sideSeam(plan, 13, P, 8),
    faceLine: flatShape(plan.x + 4, PLINTH_H + 3, side - 4, CASE_TOP - 3, 5),
    bezel: recessOf(BEZEL(cx), FRONT),
    crt: recessOf(crt, FRONT - BEZEL(cx).depth),
    scan: scan.join(""),
    glow: flatShape(crt.x0 + 8, crt.z0 + 8, crt.x1 - 8, crt.z1 - 8, 14, 8),
    slotFace: flatShape(cx + mirror * 15 - 9, 8.6, cx + mirror * 15 + 9, 11.4, 1.4),
    buttons: [cx - mirror * 4, cx - mirror * 11].map((x) => solid({ x: x - 2.4, y: FRONT, w: 4.8, d: 1.2, r: 0.6 }, 8, 3.6, 3)),
    handle: planOutline(handle, CASE_TOP, P, 6),
    handleInner: planOutline(insetPlan(handle, 2), CASE_TOP, P, 6),
    topVents: join(Array.from({ length: 6 }, (_, i) => planOutline({ x: cx - 30, y: CASE_Y + 22 + i * 1.9, w: 22, d: 0.9, r: 0.45 }, CASE_TOP, P, 3))),
    sideVents: join(vents),
    tray: solid(tray, CASE_TOP, TRAY_H, 4, 0.5),
    traySlot: planOutline(slot, CASE_TOP + TRAY_H, P, 3),
    traySlotFill: onTop(roundedPlan(slot, 3), CASE_TOP + TRAY_H, P, true),
    trayScrews: [at([cx, tray.y + 2.4, CASE_TOP + TRAY_H]), at([cx, tray.y + tray.d - 2.4, CASE_TOP + TRAY_H])],
    lampBase: cyl(lx, ly, 4.4, CASE_TOP, 1.4, 28),
    lamp: cyl(lx, ly, 3, CASE_TOP + 1.4, 2.6, 28),
    lampFill: onTop(circleRing(lx, ly, 3, 28), CASE_TOP + 4, P, true),
    lampLens: ring(lx, ly, 1.6, CASE_TOP + 4, P, 20),
    boss: solid({ x: boss - 3.2, y: FRONT, w: 6.4, d: 2.6, r: 0.8 }, 4.6, 6, 3),
    bossRing: sideRing([boss, FRONT + 2.6, 7.6], 1.6, "y", P, 16),
  };
}

export const TERMINALS = { claude: terminal("claude"), codex: terminal("codex") };

// ---------------------------------------------------------------- keyboards

function keyboard(agent: Agent) {
  const plan: Plan = { x: TERM_X[agent] - 40, y: KEYS_Y, w: 80, d: 28, r: 3 };
  const deck = insetPlan(plan, 2.4);
  const keys: string[] = [];
  const pitch = 5.4;
  const top = 4.6;
  for (let row = 0; row < 4; row++) {
    const offset = [0, 1.4, 2.2, 3.4][row]!;
    for (let col = 0; col < 13 - (row ? 1 : 0); col++) {
      keys.push(planOutline({ x: deck.x + 2.4 + offset + col * pitch, y: deck.y + 1.8 + row * 4.6, w: 4.4, d: 3.6, r: 0.7 }, top, P, 2));
    }
  }
  keys.push(planOutline({ x: deck.x + 16, y: deck.y + 1.8 + 4 * 4.6, w: 34, d: 3.4, r: 0.7 }, top, P, 2));
  return {
    halo: haloOf(plan, 0, 4, P),
    base: solid(plan, 0, 2.6, 4, 0.5),
    deck: solid(deck, 2.6, top - 2.6, 4, 0.4),
    keys: join(keys),
  };
}

export const KEYBOARDS = { claude: keyboard("claude"), codex: keyboard("codex") };

// A coiled cord from each keyboard's back to the terminal's front, like the bench's.
const CORD_X = (agent: Agent) => TERM_X[agent] + (agent === "claude" ? -20 : 20);
export const CORDS = (["claude", "codex"] as Agent[]).map((agent) => {
  const x = CORD_X(agent);
  return {
    d: pathOf([at([x, FRONT + 2, 6.8]), at([x, FRONT + 5, 0.6]), at([x, KEYS_Y - 3, 0.6]), at([x, KEYS_Y, 1.6])]),
    ends: [at([x, FRONT + 2, 6.8]), at([x, KEYS_Y, 1.6])],
    boss: solid({ x: x - 2.4, y: FRONT, w: 4.8, d: 2, r: 0.6 }, 4.6, 4.4, 3),
    ring: sideRing([x, FRONT + 2, 6.8], 1.1, "y", P, 14),
  };
});

// ---------------------------------------------------------------- the loose cables and their plugs

export const EDGE_X = { claude: desk("claude").x + desk("claude").w, codex: desk("codex").x } as const; // the edge facing the other

function looseCable(agent: Agent) {
  const dir = agent === "claude" ? 1 : -1;
  const boss = BOSS_X(agent);
  const edge = EDGE_X[agent];
  const plugStart = edge - dir * 14; // the plug rests on the desk, its tip just short of the edge
  const tip = plugStart + dir * PLUG_LEN;
  const route: Point3[] = [
    [boss, FRONT + 2.6, 7.6],
    [boss, FRONT + 6, 0.6],
    [boss, CABLE_Y, 0.6],
    [plugStart, CABLE_Y, 0.6],
  ];
  const body: Plan = dir > 0 ? { x: plugStart, y: CABLE_Y - 3, w: PLUG_LEN, d: 6, r: 1.2 } : { x: tip, y: CABLE_Y - 3, w: PLUG_LEN, d: 6, r: 1.2 };
  const pins = [CABLE_Y - 1.4, CABLE_Y + 1.4].map((y) => segment([tip, y, 2.2], [tip + dir * 3.2, y, 2.2]));
  return {
    d: pathOf(route.map(at)),
    start: at(route[0]!),
    tip: [tip, CABLE_Y, 2.2] as Point3,
    body: solid(body, 0, 4.4, 3, 0.4),
    grip: join([0.35, 0.5, 0.65].map((k) => {
      const x = body.x + body.w * k;
      return onTop([[x, CABLE_Y - 3], [x, CABLE_Y + 3]], 4.4, P);
    })),
    pins: join(pins),
    pinEnds: [CABLE_Y - 1.4, CABLE_Y + 1.4].map((y) => at([tip + dir * 3.2, y, 2.2])),
  };
}

export const LOOSE = { claude: looseCable("claude"), codex: looseCable("codex") };

// ---------------------------------------------------------------- cards

const CARD_PLAN: Plan = { x: -CARD_T / 2, y: -CARD_HALF, w: CARD_T, d: CARD_HALF * 2, r: 0.4 };

function cardOf(agent: Agent) {
  const ty = TAB_Y[agent];
  const face = CARD_T / 2;
  const rows = [CARD_H - 5, CARD_H - 8.5, CARD_H - 12, CARD_H - 15.5];
  const lengths = [18, 21, 14, 19];
  return {
    body: solid(CARD_PLAN, 0, CARD_H, 2),
    tab: solid({ x: -CARD_T / 2, y: ty, w: CARD_T, d: TAB_D, r: 0.6 }, CARD_H, TAB_H, 2),
    rules: join(rows.map((z, i) => segment([face, -CARD_HALF + 3, z], [face, -CARD_HALF + 3 + lengths[i]!, z]))),
  };
}

export const CARDS = { claude: cardOf("claude"), codex: cardOf("codex") };

// The clip that hides a card below the face it rises through (a tray's top), at world x, y.
export function clipAbove(x: number, y: number, z: number) {
  const a = at([x, y - CARD_HALF - 2, z]);
  const b = at([x, y + CARD_HALF + 2, z]);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const far = 40;
  return pathOf(
    [
      [a[0] - dx * far, a[1] - dy * far],
      [b[0] + dx * far, b[1] + dy * far],
      [b[0] + dx * far, b[1] + dy * far - 2000],
      [a[0] - dx * far, a[1] - dy * far - 2000],
    ],
    true,
  );
}
