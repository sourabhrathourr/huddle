import { CARD_H, CARD_SEAT_TRAY, CARRY_Z, GANTRY_HOME, HOIST_Z, LEDGER_FLOOR, SLOTS, TERM_X, slotX } from "./view";

export type Agent = "claude" | "codex";
export type Who = Agent | "you";

export interface Message {
  from: Who;
  to: Who | "both";
  verb: string;
  text: string;
  // What the sender's and receiver's screens show: at most 19 characters a line.
  screen: [string, string, string];
}

// One real shape of a huddle: a question, a proposal, a rejection with reasons, a better fix, agreement, a report.
export const SCRIPT: Message[] = [
  {
    from: "you",
    to: "both",
    verb: "asks",
    text: "Retries double-charge a customer now and then. Find out why.",
    screen: ["why do retries", "double-charge?", ""],
  },
  {
    from: "claude",
    to: "codex",
    verb: "proposes",
    text: "My read: two retries can overlap. Proposal: put a lock around retry() in worker.py.",
    screen: ["lock retry() so", "two can't overlap", ""],
  },
  {
    from: "codex",
    to: "claude",
    verb: "rejects",
    text: "Disagree. It isn't overlap: runner.py:88 retries a job after a timeout even when it has already committed. A lock won't stop that.",
    screen: ["no: not overlap.", "runner.py:88 retry", "committed jobs"],
  },
  {
    from: "claude",
    to: "codex",
    verb: "concedes",
    text: "You're right, lock dropped. commit() at runner.py:120 marks the job done before the ack, so a timeout there retries finished work. Skip the retry once committed?",
    screen: ["right. commit() at", "runner.py:120 is", "before the ack"],
  },
  {
    from: "codex",
    to: "claude",
    verb: "agrees",
    text: "Agreed: skip the retry once the job is committed. Still open: nothing. Next: you take runner.py, I take the tests.",
    screen: ["agreed. skip retry", "once committed.", "I take the tests."],
  },
  {
    from: "claude",
    to: "you",
    verb: "reports",
    text: "We agree on one bug and its fix. Should I make it?",
    screen: ["we agree on the", "bug and the fix.", "make it?"],
  },
];

export const NAMES: Record<Who, string> = { claude: "Claude", codex: "Codex", you: "You" };
export const readersOf = (message: Message): Who[] =>
  message.to === "both" ? ["claude", "codex"] : [message.to];

// ---------------------------------------------------------------- tracks

interface Key {
  t: number;
  v: number;
}

const ease = (u: number) => u * u * u * (u * (u * 6 - 15) + 10);

class Track {
  keys: Key[] = [];
  constructor(public value: number, private smooth = true) {
    this.keys.push({ t: 0, v: value });
  }
  // Glide from wherever the track is at t0 to v at t1.
  to(t0: number, t1: number, v: number) {
    const last = this.keys[this.keys.length - 1]!;
    if (t0 > last.t) this.keys.push({ t: t0, v: last.v });
    this.keys.push({ t: t1, v });
    this.value = v;
    return this;
  }
  set(t: number, v: number) {
    return this.to(t, t, v);
  }
  at(t: number) {
    const keys = this.keys;
    if (t <= keys[0]!.t) return keys[0]!.v;
    for (let index = 1; index < keys.length; index++) {
      const b = keys[index]!;
      if (t < b.t) {
        const a = keys[index - 1]!;
        if (!this.smooth || b.t === a.t) return a.v;
        return a.v + (b.v - a.v) * ease((t - a.t) / (b.t - a.t));
      }
    }
    return keys[keys.length - 1]!.v;
  }
}

// ---------------------------------------------------------------- the timeline

export const WHO_CODE: Record<Who, number> = { you: 0, claude: 1, codex: 2 };
export const WHO_OF = ["you", "claude", "codex"] as const;

// Phase lengths in seconds.
const TYPE = 1.5;
const REACH = 0.7;
const LOWER = 0.6;
const LIFT = 0.7;
const CARRY = 1.5;
const DROP = 0.9;
const RISE = 0.6;
const PULSE = 0.8;
const READ = 0.7;
const HOLD = 2.4;
const CLEAR = 1.2;

// The gripper hangs from the hoist; this is the height of its jaws (the top of a card it holds).
export const HOOK_REST = HOIST_Z - 7;

const tracks = {
  gantry: new Track(GANTRY_HOME),
  hook: new Track(HOOK_REST),
  cardX: new Track(TERM_X.claude),
  cardZ: new Track(CARD_SEAT_TRAY - CARD_H),
  cardFloor: new Track(CARD_SEAT_TRAY + 4, false),
  cardOn: new Track(0, false),
  cardWho: new Track(1, false),
  stored: new Track(0, false),
  fade: new Track(1),
  readClaude: new Track(-1),
  readCodex: new Track(-1),
  workClaude: new Track(0),
  workCodex: new Track(0),
  wakeClaude: new Track(0),
  wakeCodex: new Track(0),
  pulse: new Track(0),
  pulseWho: new Track(0, false),
  pulseDir: new Track(0, false),
  screenClaude: new Track(-1, false),
  screenCodex: new Track(-1, false),
  typedClaude: new Track(1),
  typedCodex: new Track(1),
  current: new Track(-1, false),
};

export type Channel = keyof typeof tracks;
export const STARTS: number[] = [];

const read = (agent: Agent) => (agent === "claude" ? tracks.readClaude : tracks.readCodex);
const work = (agent: Agent) => (agent === "claude" ? tracks.workClaude : tracks.workCodex);
const wake = (agent: Agent) => (agent === "claude" ? tracks.wakeClaude : tracks.wakeCodex);
const screen = (agent: Agent) => (agent === "claude" ? tracks.screenClaude : tracks.screenCodex);
const typed = (agent: Agent) => (agent === "claude" ? tracks.typedClaude : tracks.typedCodex);

const hookFor = (cardBottom: number) => cardBottom + CARD_H;

let t = 0.6;
SCRIPT.forEach((message, index) => {
  STARTS.push(t - 0.6);
  tracks.current.set(t - 0.6, index);
  const x = slotX(index);
  const cardBottomInSlot = LEDGER_FLOOR;
  if (message.from === "you") {
    // Your message comes in through the bulkhead cable and the ledger files it from below.
    tracks.pulseWho.set(t, 0);
    tracks.pulseDir.set(t, 1);
    tracks.pulse.set(t, 0).to(t, t + PULSE, 1);
    t += PULSE;
    tracks.pulse.set(t + 0.01, 0);
    tracks.cardWho.set(t, WHO_CODE.you);
    tracks.cardX.set(t, x);
    tracks.cardFloor.set(t, LEDGER_FLOOR);
    tracks.cardZ.set(t, cardBottomInSlot - CARD_H);
    tracks.cardOn.set(t, 1);
    tracks.cardZ.to(t, t + RISE + 0.4, cardBottomInSlot);
    t += RISE + 0.4;
  } else {
    const agent = message.from;
    const home = TERM_X[agent];
    // Typing: the agent works, its screen fills, and the card prints up out of its tray.
    work(agent).to(t, t + 0.3, 1);
    wake(agent).to(t, t + 0.3, 0);
    screen(agent).set(t, index);
    typed(agent).set(t, 0).to(t, t + TYPE, 1);
    tracks.cardWho.set(t, WHO_CODE[agent]);
    tracks.cardX.set(t, home);
    tracks.cardFloor.set(t, CARD_SEAT_TRAY + 4);
    tracks.cardZ.set(t, CARD_SEAT_TRAY - CARD_H);
    tracks.cardOn.set(t, 1);
    tracks.cardZ.to(t + 0.3, t + TYPE, CARD_SEAT_TRAY);
    tracks.gantry.to(t + 0.2, t + 0.2 + REACH + 0.6, home);
    t += Math.max(TYPE, REACH + 0.8);
    work(agent).to(t, t + 0.4, 0);
    // The hook comes down, takes the card and lifts it clear of the tray.
    tracks.hook.to(t, t + LOWER, hookFor(CARD_SEAT_TRAY));
    t += LOWER + 0.15;
    tracks.cardZ.set(t, CARD_SEAT_TRAY);
    tracks.cardFloor.set(t, -999);
    tracks.hook.to(t, t + LIFT, hookFor(CARRY_Z));
    tracks.cardZ.to(t, t + LIFT, CARRY_Z);
    t += LIFT;
    // Carry it along the rail to the next free slot, and file it.
    tracks.gantry.to(t, t + CARRY, x);
    tracks.cardX.to(t, t + CARRY, x);
    t += CARRY;
    tracks.hook.to(t, t + DROP, hookFor(cardBottomInSlot));
    tracks.cardZ.to(t, t + DROP, cardBottomInSlot);
    t += DROP;
    tracks.cardFloor.set(t, LEDGER_FLOOR);
    tracks.hook.to(t + 0.1, t + 0.1 + LIFT, HOOK_REST);
    t += 0.2;
  }
  // Stored: it is message `index + 1` in huddle.db.
  tracks.cardOn.set(t, 0);
  tracks.stored.set(t, index + 1);
  t += 0.25;
  // Wake each reader: a pulse down its cable, then its lamp, and its cursor moves to the new message.
  const agents = readersOf(message).filter((who): who is Agent => who !== "you");
  tracks.pulseWho.set(t, agents.length === 2 ? 3 : agents.length ? WHO_CODE[agents[0]!] : WHO_CODE.you);
  tracks.pulseDir.set(t, -1);
  tracks.pulse.set(t, 0).to(t, t + PULSE, 1);
  tracks.pulse.set(t + PULSE + 0.01, 0);
  t += PULSE;
  for (const agent of agents) {
    wake(agent).to(t, t + 0.25, 1);
    read(agent).to(t, t + READ, index);
    screen(agent).set(t, index);
    typed(agent).set(t, 1);
  }
  t += READ + HOLD;
  for (const agent of agents) wake(agent).to(t - 0.6, t, 0);
});

// Then the huddle is cleared and the tour begins again.
export const END = t + 0.4;
tracks.fade.to(END, END + CLEAR, 0);
tracks.gantry.to(END, END + CLEAR, GANTRY_HOME);
tracks.readClaude.to(END, END + CLEAR, -1);
tracks.readCodex.to(END, END + CLEAR, -1);
export const CYCLE = END + CLEAR + 0.3;
tracks.stored.set(CYCLE - 0.01, 0);
tracks.fade.set(CYCLE - 0.01, 1);
tracks.screenClaude.set(END + CLEAR, -1);
tracks.screenCodex.set(END + CLEAR, -1);
tracks.current.set(END, -1);

export interface Pose {
  gantry: number;
  hook: number;
  card: { on: boolean; x: number; z: number; floor: number; who: Who };
  stored: number;
  fade: number;
  read: Record<Agent, number>;
  work: Record<Agent, number>;
  wake: Record<Agent, number>;
  pulse: { at: number; who: number; dir: number };
  screen: Record<Agent, { index: number; typed: number }>;
  current: number;
}

export function poseAt(time: number): Pose {
  const s = ((time % CYCLE) + CYCLE) % CYCLE;
  const v = (channel: Channel) => tracks[channel].at(s);
  return {
    gantry: v("gantry"),
    hook: v("hook"),
    card: { on: v("cardOn") > 0, x: v("cardX"), z: v("cardZ"), floor: v("cardFloor"), who: WHO_OF[v("cardWho")]! },
    stored: v("stored"),
    fade: v("fade"),
    read: { claude: v("readClaude"), codex: v("readCodex") },
    work: { claude: v("workClaude"), codex: v("workCodex") },
    wake: { claude: v("wakeClaude"), codex: v("wakeCodex") },
    pulse: { at: v("pulse"), who: v("pulseWho"), dir: v("pulseDir") },
    screen: {
      claude: { index: v("screenClaude"), typed: v("typedClaude") },
      codex: { index: v("screenCodex"), typed: v("typedCodex") },
    },
    current: v("current"),
  };
}

export function readoutOf(pose: Pose) {
  if (pose.current < 0) return `huddle 1 · ${SLOTS} slots · idle`;
  const message = SCRIPT[pose.current]!;
  const to = message.to === "both" ? "both" : NAMES[message.to];
  return `#${pose.current + 1} · ${NAMES[message.from]} → ${to} · ${message.verb}`;
}

export const REST_POSE = poseAt(0);
export const FINAL_TIME = END - 0.01;
