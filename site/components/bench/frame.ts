import { pathOf, type Flat, type Point3 } from "../iso/iso-kit";
import { BULKHEAD, CABLE_Y, CARD_HALF, FRONT, LEDGER_FRONT, PORT_X, PORT_Z, SLOT, TERM_X, at, slotX } from "./view";
import type { Agent, Who } from "./model";

// What the live figure needs each frame, kept apart from the static geometry so little ships to the client.

const BOSS = (agent: Agent) => TERM_X[agent] + (agent === "claude" ? 37 : -37);

// Each cable starts at its ledger port and ends at the far side.
export const CABLES: Record<Who, Point3[]> = {
  claude: [
    [PORT_X.claude, LEDGER_FRONT + 2.6, PORT_Z],
    [PORT_X.claude, LEDGER_FRONT + 6, 0.6],
    [PORT_X.claude, CABLE_Y, 0.6],
    [BOSS("claude"), CABLE_Y, 0.6],
    [BOSS("claude"), FRONT + 2.6, 7.6],
  ],
  codex: [
    [PORT_X.codex, LEDGER_FRONT + 2.6, PORT_Z],
    [PORT_X.codex, LEDGER_FRONT + 6, 0.6],
    [PORT_X.codex, CABLE_Y, 0.6],
    [BOSS("codex"), CABLE_Y, 0.6],
    [BOSS("codex"), FRONT + 2.6, 7.6],
  ],
  you: [
    [PORT_X.you, LEDGER_FRONT + 2.6, PORT_Z],
    [PORT_X.you, LEDGER_FRONT + 6, 0.6],
    [PORT_X.you, BULKHEAD.y + BULKHEAD.d / 2, 0.6],
    [BULKHEAD.x + BULKHEAD.w, BULKHEAD.y + BULKHEAD.d / 2, 3.5],
  ],
};

export const riderX = (read: number) => slotX(0) + read * SLOT;

// The clip that hides a card below the face it rises through (a tray's top or the ledger's floor).
export function clipAbove(x: number, z: number) {
  const a = at([x, -CARD_HALF - 2, z]);
  const b = at([x, CARD_HALF + 2, z]);
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

// Where along a cable a pulse is, from its ledger end (0) to its far end (1).
const lengths = (points: Point3[]) => {
  const out = [0];
  for (let i = 1; i < points.length; i++) {
    const [ax, ay, az] = points[i - 1]!;
    const [bx, by, bz] = points[i]!;
    out.push(out[i - 1]! + Math.hypot(bx - ax, by - ay, bz - az));
  }
  return out;
};
const CABLE_LENGTHS = Object.fromEntries((Object.keys(CABLES) as Who[]).map((who) => [who, lengths(CABLES[who])])) as Record<Who, number[]>;

export function alongCable(who: Who, u: number): Flat {
  const points = CABLES[who];
  const total = CABLE_LENGTHS[who];
  const want = Math.min(Math.max(u, 0), 1) * total[total.length - 1]!;
  for (let i = 1; i < points.length; i++) {
    if (want <= total[i]! || i === points.length - 1) {
      const span = total[i]! - total[i - 1]! || 1;
      const k = Math.min(Math.max((want - total[i - 1]!) / span, 0), 1);
      const a = points[i - 1]!;
      const b = points[i]!;
      return at([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]);
    }
  }
  return at(points[0]!);
}

