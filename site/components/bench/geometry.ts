import {
  cameraOf,
  corners,
  circleRing,
  cylinder,
  haloOf,
  insetPlan,
  onTop,
  pathOf,
  planOutline,
  ring,
  roundedPlan,
  sideArc,
  sideMatrix,
  sideRing,
  sideSeam,
  sideTicks,
  slabOf,
  topTicks,
  type Flat,
  type Plan,
  type Plane,
  type Point3,
  type SolidPaths,
} from "../iso/iso-kit";
import {
  ARM_H,
  ARM_Z,
  BENCH,
  BENCH_H,
  BULKHEAD,
  BULKHEAD_H,
  CABLE_Y,
  CARD_H,
  CARD_HALF,
  CARD_T,
  CASE_TOP,
  CASE_Y,
  FOOT_H,
  FRONT,
  FRONT_WALL,
  HOIST_Z,
  KEYS_Y,
  LANE_Y,
  LEDGER,
  LEDGER_BASE,
  LEDGER_FLOOR,
  LEDGER_FRONT,
  P,
  PLINTH_H,
  PORT_X,
  PORT_Z,
  POST,
  POST_X,
  RAIL_D,
  RAIL_TOP,
  RAIL_Y,
  RAIL_Z,
  SLOT,
  SLOTS,
  TAB_D,
  TAB_H,
  TAB_Y,
  TERM_X,
  TRAY_H,
  WALL,
  WALL_TOP,
  at,
  caseOf,
  depth,
  keyboardOf,
  slotX,
} from "./view";
import { SCRIPT, type Agent, type Who } from "./model";
import { CABLES } from "./frame";

const solid = (plan: Plan, z: number, h: number, steps = 6, bevel = 0) => slabOf(plan, z, h, P, steps, bevel);
const cyl = (cx: number, cy: number, r: number, z: number, h: number, steps = 32, bevel = 0) => cylinder(cx, cy, r, z, h, P, steps, bevel);
const segment = (a: Point3, b: Point3) => pathOf([at(a), at(b)]);
const join = (paths: string[]) => paths.filter(Boolean).join("");
const byDepth = (points: Plane[]) => [...points].sort((a, b) => depth([a[0], a[1], 0]) - depth([b[0], b[1], 0]));

// A face plane: maps local (x, -z) onto the vertical face at y, for screens, slots and engraving.
export const planeOf = (y: number) => sideMatrix([0, y], 0, P, "left");
const flatShape = (x0: number, z0: number, x1: number, z1: number, r: number, steps = 6) =>
  pathOf(roundedPlan({ x: x0, y: z0, w: x1 - x0, d: z1 - z0, r }, steps).map(([u, z]) => [u, -z] as Flat), true);
// A closed slot on the +x face of a box, for vents.
const sideSlot = (x: number, y: number, z0: number, z1: number, half = 0.8) =>
  pathOf(roundedPlan({ x: y - half, y: z0, w: half * 2, d: z1 - z0, r: half }, 4).map(([u, z]) => at([x, u, z])), true);

// ---------------------------------------------------------------- recesses on a front face

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

export function recessOf({ x0, x1, z0, z1, r, depth: deep }: Window, y: number): Recess {
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
    const quad = pathOf([at([ax, y, az]), at([bx, y, bz]), at([bx, y - deep, bz]), at([ax, y - deep, az])], true);
    if (nz >= nx) tops.push(quad);
    else sides[Math.min(3, Math.max(0, Math.floor(((nx * -sinA + 1) / 2) * 4)))]!.push(quad);
  });
  return { shape: flatShape(x0, z0, x1, z1, r), face: planeOf(y), back: planeOf(y - deep), tops: tops.join(""), sides: sides.map((list) => list.join("")) };
}

// ---------------------------------------------------------------- the bench

const BENCH_SCREWS = corners(BENCH, 10);
const BENCH_PLATE: Plan = { x: BENCH.x + 18, y: BENCH.y + BENCH.d - 26, w: 58, d: 14, r: 2 };
const STRIP: Plan = { x: BENCH.x + 100, y: BENCH.y + BENCH.d - 14, w: 280, d: 7, r: 1 };
const STRIP_TICKS = topTicks(STRIP.x + 4, STRIP.x + STRIP.w - 4, 5, 5, STRIP.y + 0.8, 0.6, [2, 3.8], P);

export const BENCH_ART = {
  halo: haloOf(BENCH, -BENCH_H - FOOT_H, BENCH_H, P),
  feet: byDepth(corners(BENCH, 26)).map(([x, y]) => [cyl(x, y, 8, -BENCH_H - FOOT_H, 1.8, 32), cyl(x, y, 6.2, -BENCH_H - FOOT_H + 1.8, FOOT_H - 1.8, 32)]),
  slab: solid(BENCH, -BENCH_H, BENCH_H, 10, 1.6),
  seam: sideSeam(BENCH, -BENCH_H + 3.5, P, 10),
  groove: planOutline(insetPlan(BENCH, 5), 0, P, 10),
  screwRings: join(BENCH_SCREWS.map(([x, y]) => ring(x, y, 2.2, 0, P, 16))),
  screws: BENCH_SCREWS.map(([x, y]) => at([x, y, 0])),
  plate: solid(BENCH_PLATE, 0, 0.8, 3),
  plateLine: planOutline(insetPlan(BENCH_PLATE, 1.6), 0.8, P, 3),
  plateRule: join([0, 1, 2].map((row) => onTop([[BENCH_PLATE.x + 9, BENCH_PLATE.y + 3.6 + row * 2.6], [BENCH_PLATE.x + [40, 30, 44][row]!, BENCH_PLATE.y + 3.6 + row * 2.6]], 0.8, P))),
  plateScrews: [at([BENCH_PLATE.x + 4, BENCH_PLATE.y + BENCH_PLATE.d / 2, 0.8]), at([BENCH_PLATE.x + BENCH_PLATE.w - 4, BENCH_PLATE.y + BENCH_PLATE.d / 2, 0.8])],
  strip: solid(STRIP, 0, 0.6, 3),
  stripMinor: STRIP_TICKS.minor,
  stripMajor: STRIP_TICKS.major,
};

// ---------------------------------------------------------------- the gantry

const POSTS = [-POST_X, POST_X];
const RAIL_PLAN: Plan = { x: -POST_X - 10, y: RAIL_Y - RAIL_D / 2, w: (POST_X + 10) * 2, d: RAIL_D, r: 1.5 };
const RAIL_FACE = RAIL_Y + RAIL_D / 2;
const RAIL_TICKS = sideTicks(-POST_X + 18, POST_X - 18, 5, 5, RAIL_FACE, RAIL_TOP, [1.8, 3.6], P);
const STOP_X = [-POST_X + 14, POST_X - 14];

export const GANTRY_ART = {
  posts: POSTS.map((x) => {
    const base: Plan = { x: x - 11, y: RAIL_Y - 11, w: 22, d: 22, r: 2.5 };
    const post: Plan = { x: x - POST / 2, y: RAIL_Y - POST / 2, w: POST, d: POST, r: 1.5 };
    const collar: Plan = insetPlan(post, -2);
    return {
      base: solid(base, 0, 2.6, 4, 0.5),
      baseScrews: corners(base, 3.2).map(([px, py]) => at([px, py, 2.6])),
      post: solid(post, 2.6, RAIL_Z - 2.6 - 6, 4),
      postSeam: join([30, 60, 90].map((z) => sideSeam(post, z, P, 4))),
      collar: solid(collar, RAIL_Z - 6, 6, 4, 0.4),
      collarScrew: at([x, RAIL_Y + POST / 2 + 2, RAIL_Z - 3]),
    };
  }),
  rail: solid(RAIL_PLAN, RAIL_Z, RAIL_TOP - RAIL_Z, 4, 0.8),
  railMinor: RAIL_TICKS.minor,
  railMajor: RAIL_TICKS.major,
  railScrews: POSTS.map((x) => at([x, RAIL_Y, RAIL_TOP])),
  stops: STOP_X.map((x) => solid({ x: x - 2, y: RAIL_Y - RAIL_D / 2 - 0.6, w: 4, d: RAIL_D + 1.2, r: 0.8 }, RAIL_TOP, 3, 3, 0.3)),
  stopScrews: STOP_X.map((x) => at([x, RAIL_Y, RAIL_TOP + 3])),
};

// The carriage, arm and hoist, built at x = 0 and moved with the gantry.
const CARRIAGE: Plan = { x: -15, y: RAIL_Y - 8, w: 30, d: 16, r: 2.5 };
const CARRIAGE_H = 9;
const ARM: Plan = { x: -4, y: RAIL_Y + 6, w: 8, d: -(RAIL_Y + 6) + 7, r: 1.5 };
const HOIST_R = 5.6;

export const CARRIAGE_ART = {
  halo: solid(insetPlan(CARRIAGE, 2), RAIL_TOP, 0.1).fill,
  bushes: [-1, 1].map((side) => solid({ x: side < 0 ? -15 : 9, y: RAIL_Y - RAIL_D / 2 - 2, w: 6, d: RAIL_D + 4, r: 1 }, RAIL_TOP - 3, 3.4, 3)),
  block: solid(CARRIAGE, RAIL_TOP, CARRIAGE_H, 4, 0.8),
  blockSeam: sideSeam(CARRIAGE, RAIL_TOP + 3.4, P, 4),
  blockLine: planOutline(insetPlan(CARRIAGE, 2.2), RAIL_TOP + CARRIAGE_H, P, 4),
  blockScrews: corners(CARRIAGE, 3.4).map(([x, y]) => at([x, y, RAIL_TOP + CARRIAGE_H])),
  knob: cyl(-9, RAIL_Y - 2, 2.8, RAIL_TOP + CARRIAGE_H, 3.4, 20),
  knobRing: ring(-9, RAIL_Y - 2, 1.2, RAIL_TOP + CARRIAGE_H + 3.4, P, 14),
  index: segment([0, CARRIAGE.y + CARRIAGE.d, RAIL_TOP + 5], [0, CARRIAGE.y + CARRIAGE.d, RAIL_TOP + 0.6]),
};

export const ARM_ART = {
  arm: solid(ARM, ARM_Z, ARM_H, 4, 0.6),
  armLine: planOutline({ x: -1.2, y: ARM.y + 3, w: 2.4, d: ARM.d - 6, r: 1.2 }, ARM_Z + ARM_H, P, 3),
  armScrews: [at([0, ARM.y + 2, ARM_Z + ARM_H]), at([0, -6, ARM_Z + ARM_H]), at([0, 3, ARM_Z + ARM_H])],
};

export const HOIST_ART = {
  housing: cyl(0, 0, HOIST_R, HOIST_Z + 2, ARM_Z - HOIST_Z - 2, 40),
  band: join([HOIST_Z + 4.6].map((z) => sideArc(0, 0, HOIST_R, z, P, 24))),
  nose: cyl(0, 0, 2.6, HOIST_Z, 2, 24),
};

// The gripper's jaws, built with their bottom (the top of a held card) at z = 0.
export const GRIPPER_ART = {
  body: solid({ x: -2.6, y: -2.6, w: 5.2, d: 5.2, r: 1.2 }, 0, 3.4, 3, 0.3),
  jaw: segment([0, -2.6, 0.4], [0, 2.6, 0.4]),
  pin: at([0, 0, 3.4]),
};

// ---------------------------------------------------------------- the terminals

export const BEZEL = (cx: number): Window => ({ x0: cx - 38, x1: cx + 38, z0: 17, z1: 74, r: 5, depth: 1.6 });
export const CRT = (cx: number): Window => ({ x0: cx - 33, x1: cx + 33, z0: 22, z1: 70, r: 7, depth: 3 });
export const SCREEN_ROWS = { header: 63.6, rule: 59.6, direction: 53.4, lines: [45.4, 38.2, 31] } as const;
export const LAMP = (cx: number): Plane => [cx + 32, 20];
export const BOSS_X = (agent: Agent) => TERM_X[agent] + (agent === "claude" ? 37 : -37);
const CORD_X = (agent: Agent) => TERM_X[agent] + (agent === "claude" ? 20 : -20);

function terminal(agent: Agent) {
  const cx = TERM_X[agent];
  const plan = caseOf(cx);
  const side = plan.x + plan.w;
  const tray: Plan = { x: cx - 6, y: -CARD_HALF - 3, w: 12, d: CARD_HALF * 2 + 6, r: 2 };
  const slot: Plan = { x: cx - 1.6, y: -CARD_HALF - 1.2, w: 3.2, d: CARD_HALF * 2 + 2.4, r: 1 };
  const [lx, ly] = LAMP(cx);
  const boss = BOSS_X(agent);
  const cord = CORD_X(agent);
  const ventRow = (from: number, to: number) => {
    const out: number[] = [];
    for (let y = from; y <= to + 1e-9; y += 3.4) out.push(y);
    return out;
  };
  const crt = CRT(cx);
  // Codex's front panel is Claude's mirrored, so the slot stays clear of its keyboard socket.
  const mirror = agent === "claude" ? -1 : 1;
  const scan: string[] = [];
  for (let z = crt.z0 + 1.4; z < crt.z1; z += 1.8) scan.push(`M${crt.x0} ${(-z).toFixed(1)}H${crt.x1}`);
  const handle: Plan = { x: cx - 30, y: CASE_Y + 3, w: 60, d: 7, r: 3.5 };
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
    topVents: join(Array.from({ length: 6 }, (_, i) => planOutline({ x: cx - 30, y: 19.5 + i * 1.9, w: 22, d: 0.9, r: 0.45 }, CASE_TOP, P, 3))),
    sideVents: join([...ventRow(CASE_Y + 10, CASE_Y + 46).map((y) => sideSlot(side, y, CASE_TOP - 40, CASE_TOP - 12))]),
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
    cordBoss: solid({ x: cord - 2.4, y: FRONT, w: 4.8, d: 2, r: 0.6 }, 4.6, 4.4, 3),
    cordRing: sideRing([cord, FRONT + 2, 6.8], 1.1, "y", P, 14),
  };
}

export const TERMINALS = { claude: terminal("claude"), codex: terminal("codex") };

// ---------------------------------------------------------------- keyboards

function keyboard(agent: Agent) {
  const plan = keyboardOf(TERM_X[agent]);
  const deck = insetPlan(plan, 2.4);
  const keys: string[] = [];
  const pitch = 5.4;
  const top = 4.6;
  for (let row = 0; row < 4; row++) {
    const count = 13 - (row === 3 ? 0 : 0);
    const offset = [0, 1.4, 2.2, 3.4][row]!;
    for (let col = 0; col < count - (row ? 1 : 0); col++) {
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

// ---------------------------------------------------------------- the ledger (huddle.db)

const L = LEDGER;
const BACK_WALL: Plan = { x: L.x, y: L.y, w: L.w, d: WALL, r: 1 };
const LEFT_WALL: Plan = { x: L.x, y: L.y + WALL, w: WALL, d: L.d - WALL - FRONT_WALL, r: 0.4 };
const RIGHT_WALL: Plan = { x: L.x + L.w - WALL, y: L.y + WALL, w: WALL, d: L.d - WALL - FRONT_WALL, r: 0.4 };
const FRONT_PLAN: Plan = { x: L.x, y: LEDGER_FRONT - FRONT_WALL, w: L.w, d: FRONT_WALL, r: 1 };
const FLOOR: Plan = { x: L.x + WALL, y: L.y + WALL, w: L.w - WALL * 2, d: L.d - WALL - FRONT_WALL, r: 0 };
const WALL_H = WALL_TOP - LEDGER_BASE;
const PORTS = (Object.entries(PORT_X) as [Who, number][]).map(([who, x]) => ({ who, x }));
const LABEL = { x0: -18, x1: 18, z0: 17, z1: 26 };

function laneOf(y: number): Plan {
  return { x: slotX(0) - SLOT * 0.95, y: y - 1.6, w: SLOT * (SLOTS - 1) + SLOT * 1.9, d: 3.2, r: 1.2 };
}

export const LEDGER_ART = {
  halo: haloOf(insetPlan(L, -2), 0, 6, P),
  base: solid(insetPlan(L, -2.5), 0, LEDGER_BASE, 6, 0.6),
  baseScrews: corners(insetPlan(L, -2.5), 2.6).map(([x, y]) => at([x, y, LEDGER_BASE])),
  back: solid(BACK_WALL, LEDGER_BASE, WALL_H, 3, 0.4),
  left: solid(LEFT_WALL, LEDGER_BASE, WALL_H, 2, 0.4),
  floor: solid(FLOOR, LEDGER_BASE, LEDGER_FLOOR - LEDGER_BASE, 2),
  guides: join(Array.from({ length: SLOTS }, (_, i) => planOutline({ x: slotX(i) - 1.4, y: FLOOR.y + 2, w: 2.8, d: FLOOR.d - 4, r: 1.4 }, LEDGER_FLOOR, P, 3))),
  right: solid(RIGHT_WALL, LEDGER_BASE, WALL_H, 2, 0.4),
  front: solid(FRONT_PLAN, LEDGER_BASE, WALL_H, 3, 0.6),
  frontSeam: sideSeam(FRONT_PLAN, LEDGER_BASE + 3.4, P, 3),
  lanes: join([LANE_Y.claude, LANE_Y.codex].map((y) => planOutline(laneOf(y), WALL_TOP, P, 3))),
  ticks: join(Array.from({ length: SLOTS }, (_, i) => onTop([[slotX(i), LANE_Y.claude + 1.6], [slotX(i), LANE_Y.codex - 1.6]], WALL_TOP, P))),
  zero: onTop([[slotX(0) - SLOT, LANE_Y.claude + 1.6], [slotX(0) - SLOT, LANE_Y.codex - 1.6]], WALL_TOP, P),
  wallScrews: [at([L.x + 1.5, L.y + 1.5, WALL_TOP]), at([L.x + L.w - 1.5, L.y + 1.5, WALL_TOP]), at([L.x + 1.5, FRONT_PLAN.y + FRONT_WALL / 2, WALL_TOP]), at([L.x + L.w - 1.5, FRONT_PLAN.y + FRONT_WALL / 2, WALL_TOP])],
  label: flatShape(LABEL.x0, LABEL.z0, LABEL.x1, LABEL.z1, 1.2),
  labelInner: flatShape(LABEL.x0 + 1, LABEL.z0 + 1, LABEL.x1 - 1, LABEL.z1 - 1, 0.6),
  labelText: `${planeOf(LEDGER_FRONT)} translate(${(LABEL.x0 + LABEL.x1) / 2} ${-(LABEL.z0 + 2.6)})`,
  labelFace: planeOf(LEDGER_FRONT),
  ports: PORTS.map(({ x }) => ({
    boss: solid({ x: x - 3.4, y: LEDGER_FRONT, w: 6.8, d: 2.6, r: 0.8 }, PORT_Z - 3.2, 6.4, 3),
    ring: sideRing([x, LEDGER_FRONT + 2.6, PORT_Z], 1.7, "y", P, 16),
  })),
  portScrews: PORTS.flatMap(({ x }) => [at([x - 2.4, LEDGER_FRONT + 2.6, PORT_Z + 2.4]), at([x + 2.4, LEDGER_FRONT + 2.6, PORT_Z - 2.4])]),
};

// A cursor rider: one per agent, sliding along its lane on the front wall to the last message it has read.
export const RIDER_ART = (Object.keys(LANE_Y) as Agent[]).reduce(
  (out, agent) => {
    const y = LANE_Y[agent];
    out[agent] = {
      body: solid({ x: -2, y: y - 1.5, w: 4, d: 3, r: 0.8 }, WALL_TOP, 2.2, 3, 0.3),
      top: onTop(roundedPlan({ x: -2, y: y - 1.5, w: 4, d: 3, r: 0.8 }, 3), WALL_TOP + 2.2, P, true),
      tick: onTop([[0, y - 1.5], [0, y + 1.5]], WALL_TOP + 2.2, P),
    };
    return out;
  },
  {} as Record<Agent, { body: SolidPaths; top: string; tick: string }>,
);

// ---------------------------------------------------------------- message cards

const CARD_PLAN: Plan = { x: -CARD_T / 2, y: -CARD_HALF, w: CARD_T, d: CARD_HALF * 2, r: 0.4 };

// A card built standing on z = 0 at x = 0; place it with a translate.
function cardOf(who: Who) {
  const ty = TAB_Y[who];
  const face = CARD_T / 2;
  const rows = [CARD_H - 5, CARD_H - 8.5, CARD_H - 12, CARD_H - 15.5];
  const lengths = [18, 21, 14, 19];
  return {
    body: solid(CARD_PLAN, 0, CARD_H, 2),
    tab: solid({ x: -CARD_T / 2, y: ty, w: CARD_T, d: TAB_D, r: 0.6 }, CARD_H, TAB_H, 2),
    rules: join(rows.map((z, i) => segment([face, -CARD_HALF + 3, z], [face, -CARD_HALF + 3 + lengths[i]!, z]))),
  };
}

export const CARDS = { you: cardOf("you"), claude: cardOf("claude"), codex: cardOf("codex") };
export const SEATED = SCRIPT.map((message, index) => ({ who: message.from, x: slotX(index) }));

// ---------------------------------------------------------------- cables

export { CABLES };

export const CABLE_ART = (Object.entries(CABLES) as [Who, Point3[]][]).map(([who, points]) => ({
  who,
  d: pathOf(points.map(at)),
  ends: [at(points[0]!), at(points[points.length - 1]!)],
}));

export const CORDS = (["claude", "codex"] as Agent[]).map((agent) => {
  const x = CORD_X(agent);
  return {
    d: pathOf([at([x, FRONT + 2, 6.8]), at([x, FRONT + 5, 0.6]), at([x, KEYS_Y - 3, 0.6]), at([x, KEYS_Y, 1.6])]),
    ends: [at([x, FRONT + 2, 6.8]), at([x, KEYS_Y, 1.6])],
  };
});

// ---------------------------------------------------------------- the bulkhead where you plug in

export const BULKHEAD_ART = {
  halo: haloOf(BULKHEAD, 0, 3, P),
  body: solid(BULKHEAD, 0, BULKHEAD_H, 4, 0.5),
  topLine: planOutline(insetPlan(BULKHEAD, 1.6), BULKHEAD_H, P, 4),
  screws: [at([BULKHEAD.x + 2.6, BULKHEAD.y + BULKHEAD.d / 2, BULKHEAD_H]), at([BULKHEAD.x + BULKHEAD.w - 2.6, BULKHEAD.y + BULKHEAD.d / 2, BULKHEAD_H])],
  socket: sideRing([BULKHEAD.x + BULKHEAD.w / 2, BULKHEAD.y + BULKHEAD.d, BULKHEAD_H / 2], 2, "y", P, 18),
  socketFill: sideRing([BULKHEAD.x + BULKHEAD.w / 2, BULKHEAD.y + BULKHEAD.d, BULKHEAD_H / 2], 2, "y", P, 18),
  socketInner: sideRing([BULKHEAD.x + BULKHEAD.w / 2, BULKHEAD.y + BULKHEAD.d, BULKHEAD_H / 2], 0.9, "y", P, 12),
  
};

export const HOOK_TOP = HOIST_Z;
export { CARD_H };
