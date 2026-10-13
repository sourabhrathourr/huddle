"use client";

import * as React from "react";
import { pathOf, translateAlong } from "../iso/iso-kit";
import { useInView, useLoop, useStillness } from "../iso/react/live";
import { alongCable, clipAbove, riderX } from "./frame";
import { CYCLE, FINAL_TIME, NAMES, SCRIPT, poseAt, type Agent, type Pose, type Who } from "./model";
import { GRIPPER_H, HOIST_Z, LEDGER, P, at } from "./view";

const AGENTS: Agent[] = ["claude", "codex"];
const PULSE_WHO: Who[][] = [["you"], ["claude"], ["codex"], ["claude", "codex"]];
const OPEN = "M-9999 -9999H9999V9999H-9999Z";

export type Nodes = Record<string, Element | null>;

export function find(root: Element) {
  const nodes: Nodes = {};
  root.querySelectorAll("[data-part]").forEach((node) => {
    nodes[node.getAttribute("data-part")!] = node;
  });
  return nodes;
}

const put = (node: Element | null, name: string, value: string) => {
  if (node && node.getAttribute(name) !== value) node.setAttribute(name, value);
};
const show = (node: Element | null, on: boolean) => {
  const element = node as HTMLElement | SVGElement | null;
  if (element && (element.style.display === "none") === on) element.style.display = on ? "" : "none";
};
const text = (node: Element | null, value: string) => {
  if (node && node.textContent !== value) node.textContent = value;
};
const fixed = (value: number) => Math.round(value * 1000) / 1000;

function statusOf(pose: Pose, agent: Agent) {
  if (pose.work[agent] > 0.5) return "working";
  if (pose.wake[agent] > 0.5) return "woken";
  return "idle";
}

export function apply(root: Element, nodes: Nodes, pose: Pose) {
  // The gantry head, its hoist line and the gripper.
  put(nodes.head!, "transform", translateAlong(P, [pose.gantry, 0, 0]));
  const top = at([pose.gantry, 0, HOIST_Z]);
  const jaws = at([pose.gantry, 0, pose.hook + GRIPPER_H]);
  put(nodes["hoist-line"]!, "d", pathOf([top, jaws]));
  put(nodes.gripper!, "transform", translateAlong(P, [pose.gantry, 0, pose.hook]));

  // The moving card: drawn inside the ledger's walls once it is down among the filed cards.
  const { card } = pose;
  const inLedger = Math.abs(card.x) < LEDGER.w / 2 && card.z < 40;
  for (const slot of ["top", "stack"] as const) {
    const on = card.on && (slot === "stack") === inLedger;
    show(nodes[`card-${slot}`]!, on);
    if (!on) continue;
    put(nodes[`card-move-${slot}`]!, "transform", translateAlong(P, [card.x, 0, card.z]));
    put(nodes[`card-move-${slot}`]!, "data-who", card.who);
    put(nodes[`card-clip-${slot}`]!, "d", card.floor > -900 ? clipAbove(card.x, card.floor) : OPEN);
  }

  // Filed cards, and the cursor rider each agent moves to the last message it has read.
  SCRIPT.forEach((_, index) => {
    const node = nodes[`seated-${index}`] as SVGElement | null;
    const opacity = index < pose.stored ? String(fixed(pose.fade)) : "0";
    if (node && node.style.opacity !== opacity) node.style.opacity = opacity;
  });
  for (const agent of AGENTS) {
    put(nodes[`rider-${agent}`]!, "transform", translateAlong(P, [riderX(pose.read[agent]), 0, 0]));
    const lamp = nodes[`${agent}-lamp`] as SVGElement | null;
    const glow = String(fixed(Math.max(pose.work[agent], pose.wake[agent])));
    if (lamp && lamp.style.opacity !== glow) lamp.style.opacity = glow;
    put(nodes[`${agent}-screen`]!, "data-state", statusOf(pose, agent));
    text(nodes[`${agent}-status`]!, statusOf(pose, agent));
    const { index, typed } = pose.screen[agent];
    const message = SCRIPT[index];
    if (!message) {
      text(nodes[`${agent}-direction`]!, "huddle 1 · joined");
      ["ready.", "", ""].forEach((line, row) => text(nodes[`${agent}-line-${row}`]!, line));
      continue;
    }
    const outgoing = message.from === agent;
    const peer = message.to === "both" ? "both" : NAMES[message.to];
    text(nodes[`${agent}-direction`]!, outgoing ? `▸ #${index + 1} to ${peer}` : `◂ #${index + 1} from ${NAMES[message.from]}`);
    const total = message.screen.join("").length;
    let budget = outgoing ? Math.round(typed * total) : total;
    message.screen.forEach((line, row) => {
      const shown = line.slice(0, Math.max(0, budget));
      budget -= line.length;
      text(nodes[`${agent}-line-${row}`]!, shown);
    });
  }

  // Wake pulses down the cables.
  const who = PULSE_WHO[pose.pulse.who] ?? [];
  const live = pose.pulse.at > 0 && pose.pulse.at < 1;
  (["a", "b"] as const).forEach((key, index) => {
    const reader = who[index];
    const node = nodes[`pulse-${key}`]!;
    show(node, live && Boolean(reader));
    if (!live || !reader) return;
    const u = pose.pulse.dir > 0 ? 1 - pose.pulse.at : pose.pulse.at;
    const [x, y] = alongCable(reader, u);
    put(node, "transform", `translate(${fixed(x)} ${fixed(y)})`);
    put(node, "data-who", reader);
  });
  for (const cable of ["claude", "codex", "you"] as Who[]) {
    put(nodes[`cable-${cable}`]!, "data-live", live && who.includes(cable) ? "on" : "off");
  }
  put(nodes.socket!, "data-live", live && who.includes("you") ? "on" : "off");

}

export function BenchLive({ children }: { children: React.ReactNode }) {
  const root = React.useRef<HTMLDivElement>(null);
  const nodes = React.useRef<Nodes | null>(null);
  const clock = React.useRef(0);
  const inView = useInView(root);
  const still = useStillness();

  const draw = React.useCallback(() => {
    const element = root.current;
    if (!element) return;
    nodes.current ??= find(element);
    apply(element, nodes.current, poseAt(clock.current));
  }, []);

  const tick = React.useCallback(
    (dt: number) => {
      clock.current = (clock.current + dt) % CYCLE;
      draw();
      return true;
    },
    [draw],
  );
  useLoop(tick, inView && !still);

  React.useEffect(() => {
    if (still) clock.current = FINAL_TIME;
    draw();
  }, [still, draw]);

  return (
    <div ref={root} className="bn">
      {children}
    </div>
  );
}
