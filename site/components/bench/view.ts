import { boxCorners, depthOf, fitProjection, iso, type Flat, type Plan, type Point3 } from "../iso/iso-kit";

// World units are about 1 px of the real bench. x runs along the bench, y toward the front, z up.
export const WIDTH = 1000;
export const HEIGHT = 610;
export const AZIMUTH = 60;

export const BENCH: Plan = { x: -240, y: -104, w: 480, d: 212, r: 10 };
export const BENCH_H = 10;
export const FOOT_H = 6;

// The two terminals: Claude Code on the left, Codex on the right. Screens face +y.
export const TERM_X = { claude: -155, codex: 155 } as const;
export const CASE_W = 90;
export const CASE_Y = -30;
export const CASE_D = 62;
export const FRONT = CASE_Y + CASE_D;
export const PLINTH_H = 4;
export const CASE_TOP = 80;
export const caseOf = (cx: number): Plan => ({ x: cx - CASE_W / 2, y: CASE_Y, w: CASE_W, d: CASE_D, r: 6 });

// The tray on top of each terminal, where a message card is printed.
export const TRAY_H = 5;
export const TRAY_TOP = CASE_TOP + TRAY_H;
export const CARD_SEAT_TRAY = CASE_TOP + 1;

// The message card: thin in x, standing in the y-z plane.
export const CARD_T = 1.6;
export const CARD_HALF = 16;
export const CARD_H = 30;
export const TAB_H = 3.2;
export const TAB_D = 5.5;
export const TAB_Y = { you: -14.5, claude: 3.4, codex: 9.6 } as const;

// The ledger: huddle.db as a card file. One card per message, in order.
export const LEDGER: Plan = { x: -52, y: -28, w: 104, d: 64, r: 3 };
export const LEDGER_BASE = 3;
export const LEDGER_FLOOR = 5;
export const WALL = 3;
export const FRONT_WALL = 8;
export const WALL_TOP = 30;
export const SLOTS = 6;
export const SLOT = 14;
export const slotX = (index: number) => (index - (SLOTS - 1) / 2) * SLOT;
export const LEDGER_FRONT = LEDGER.y + LEDGER.d;
export const LANE_Y = { claude: LEDGER_FRONT - FRONT_WALL + 2.2, codex: LEDGER_FRONT - 2.2 } as const;

// The gantry: a rail on two posts at the back, a carriage and an arm that reaches over the bench line y = 0.
export const RAIL_Y = -82;
export const RAIL_D = 8;
export const RAIL_Z = 130;
export const RAIL_H = 8;
export const RAIL_TOP = RAIL_Z + RAIL_H;
export const POST_X = 214;
export const POST = 12;
export const ARM_Z = RAIL_TOP + 3;
export const ARM_H = 5;
export const HOIST_Z = ARM_Z - 9;
export const GRIPPER_H = 3.4;
export const CARRY_Z = TRAY_TOP + 7;
export const GANTRY_HOME = 0;

// Ports and cables.
export const PORT_Z = 10;
export const PORT_X = { claude: -30, you: 0, codex: 30 } as const;
export const CABLE_Y = 42;
export const BULKHEAD: Plan = { x: -26, y: 78, w: 16, d: 10, r: 2 };
export const BULKHEAD_H = 7;

// Keyboards in front of each terminal.
export const KEYS_Y = 50;
export const keyboardOf = (cx: number): Plan => ({ x: cx - 40, y: KEYS_Y, w: 80, d: 28, r: 3 });

export const P = fitProjection(
  [
    ...boxCorners(BENCH, -BENCH_H - FOOT_H, 0),
    ...boxCorners({ x: -POST_X - 10, y: RAIL_Y - RAIL_D / 2, w: (POST_X + 10) * 2, d: RAIL_D, r: 0 }, RAIL_Z, ARM_Z + ARM_H + 8),
  ],
  WIDTH,
  HEIGHT,
  { pad: 30, azimuth: AZIMUTH },
);

export const at = (point: Point3): Flat => iso(point, P);
export const depth = (point: Point3) => depthOf(point, P);
