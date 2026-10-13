import { Easing, interpolate } from "remotion";
import timeline from "../timeline.json";
import vo from "./vo.json";

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export type Segment = keyof typeof vo;
interface Word {
  w: string;
  start: number;
  end: number;
}
const VO = vo as Record<Segment, { duration: number; words: Word[] }>;

// A scene plays one or more voice segments. `lead` is the silence before each segment and `tail` the hold
// after the last one, in seconds. Scene lengths follow the voice, so a re-spoken line re-times the cut.
interface SceneSpec {
  id: string;
  voice: { segment: Segment; lead: number }[];
  tail: number;
}

const SPECS: SceneSpec[] = timeline.scenes as SceneSpec[];

export type SceneId = "apart" | "reveal" | "connect" | "debate" | "principle" | "watch" | "hood" | "close";

export interface Scene {
  id: SceneId;
  from: number; // frame
  duration: number; // frames
  voice: { segment: Segment; at: number }[]; // scene-local frame where each segment starts
}

const f = (seconds: number) => Math.round(seconds * FPS);

export const SCENES: Scene[] = (() => {
  let from = 0;
  return SPECS.map((spec) => {
    let t = 0;
    const voice = spec.voice.map(({ segment, lead }) => {
      t += lead;
      const at = f(t);
      t += VO[segment].duration;
      return { segment, at };
    });
    const duration = f(t + spec.tail);
    const scene = { id: spec.id as SceneId, from, duration, voice };
    from += duration;
    return scene;
  });
})();

export const TOTAL = SCENES.reduce((sum, scene) => sum + scene.duration, 0);
export const sceneOf = (id: SceneId) => SCENES.find((scene) => scene.id === id)!;

// The scene-local frame where a word is spoken: cue("debate", "disagrees"). `nth` picks a later repeat.
export function cue(segment: Segment, word: string, nth = 0, edge: "start" | "end" = "start") {
  const scene = SCENES.find((s) => s.voice.some((v) => v.segment === segment));
  if (!scene) throw new Error(`no scene speaks ${segment}`);
  const at = scene.voice.find((v) => v.segment === segment)!.at;
  const clean = (text: string) => text.toLowerCase().replace(/[^a-z0-9'$/]/g, "");
  const hits = VO[segment].words.filter((w) => clean(w.w) === clean(word));
  const hit = hits[nth];
  if (!hit) throw new Error(`"${word}" (#${nth}) is not in ${segment}`);
  return at + f(hit[edge]);
}

export const segmentEnd = (segment: Segment) => {
  const scene = SCENES.find((s) => s.voice.some((v) => v.segment === segment))!;
  return scene.voice.find((v) => v.segment === segment)!.at + f(VO[segment].duration);
};

// Motion: a strong ease-out for things arriving, ease-in-out for things moving across the screen.
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
export const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);

// 0 → 1 from frame `at` over `length` frames.
export const rise = (frame: number, at: number, length = 18, easing = EASE_OUT) =>
  interpolate(frame, [at, at + length], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing });

export const mix = (a: number, b: number, k: number) => a + (b - a) * k;

// The standard entrance: fade up from 14px below, slightly soft.
export const enter = (k: number, distance = 14): React.CSSProperties => ({
  opacity: k,
  transform: `translateY(${mix(distance, 0, k)}px)`,
  filter: k < 1 ? `blur(${mix(6, 0, k).toFixed(2)}px)` : undefined,
});

// Typed text: how much of `text` shows `frame` frames in, at `cps` characters a second.
export const typed = (text: string, frame: number, at: number, cps = 18) =>
  text.slice(0, Math.max(0, Math.floor(((frame - at) / FPS) * cps)));
