import * as React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import "./fonts";
import { FPS, SCENES, cue, mix, segmentEnd, type SceneId, type Segment } from "./lib";
import MUSIC from "./music.json";
import { Apart } from "./scenes/Apart";
import { Close } from "./scenes/Close";
import { Connect } from "./scenes/Connect";
import { Debate } from "./scenes/Debate";
import { Hood } from "./scenes/Hood";
import { Principle } from "./scenes/Principle";
import { Reveal } from "./scenes/Reveal";
import { Watch } from "./scenes/Watch";
import "./theme.css";

const VIEWS: Record<SceneId, React.FC> = {
  apart: Apart,
  reveal: Reveal,
  connect: Connect,
  debate: Debate,
  principle: Principle,
  watch: Watch,
  hood: Hood,
  close: Close,
};

const FADE = 12;

// Each scene fades up from the paper and back into it, with a little blur, so cuts never jump.
function Frame({ duration, children, first, last }: { duration: number; children: React.ReactNode; first: boolean; last: boolean }) {
  const frame = useCurrentFrame();
  const fadeIn = first ? 1 : interpolate(frame, [0, FADE], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [duration - (last ? 36 : FADE), duration], [1, 0], { extrapolateLeft: "clamp" });
  const k = Math.min(fadeIn, fadeOut);
  return <AbsoluteFill style={{ opacity: k, filter: k < 1 ? `blur(${((1 - k) * 8).toFixed(2)}px)` : undefined }}>{children}</AbsoluteFill>;
}

const at = (segment: Segment, word: string, nth = 0) => {
  const scene = SCENES.find((s) => s.voice.some((v) => v.segment === segment))!;
  return scene.from + cue(segment, word, nth);
};

interface Hit {
  sound: "tick" | "whoosh" | "typing" | "chime" | "connect";
  at: number;
  volume: number;
  length?: number; // frames, to cut a long sound short
}

const HITS: Hit[] = [
  // apart
  { sound: "tick", at: at("open", "Claude") - 2, volume: 0.57 },
  { sound: "tick", at: at("open", "Codex"), volume: 0.57 },
  { sound: "tick", at: at("problem", "Copy."), volume: 0.78 },
  { sound: "tick", at: at("problem", "Paste."), volume: 0.78 },
  { sound: "tick", at: at("problem", "Copy.", 1), volume: 0.78 },
  { sound: "tick", at: at("problem", "Paste.", 1), volume: 0.78 },
  // reveal
  // connect
  { sound: "typing", at: at("connect", "slash") - 2, volume: 0.45, length: 16 },
  { sound: "typing", at: at("connect", "dollar") - 2, volume: 0.45, length: 16 },
  { sound: "connect", at: at("connect", "That's") - 8, volume: 0.99 },
  // debate
  { sound: "tick", at: at("ask", "Retries") - 6, volume: 0.83 },
  { sound: "tick", at: at("debate", "proposes") - 10, volume: 0.83 },
  { sound: "tick", at: at("debate", "disagrees") - 8, volume: 0.83 },
  { sound: "tick", at: at("debate", "concedes") - 8, volume: 0.83 },
  { sound: "tick", at: at("debate", "Together,") - 2, volume: 0.83 },
  { sound: "chime", at: at("debate", "better") - 4, volume: 0.3 },
  // principle
  { sound: "tick", at: at("principle", "close") - 6, volume: 0.57 },
  // watch
  { sound: "typing", at: at("watch", "Step") - 4, volume: 0.42, length: 28 },
  { sound: "tick", at: at("watch", "message") - 2, volume: 0.78 },
  { sound: "tick", at: at("watch", "nothing") - 4, volume: 0.68 },
  { sound: "typing", at: at("watch", "yes.") - 10, volume: 0.39, length: 10 },
  // hood
  { sound: "tick", at: at("hood", "server.") - 6, volume: 0.47 },
  { sound: "tick", at: at("hood", "account.") - 6, volume: 0.47 },
  { sound: "tick", at: at("hood", "telemetry.") - 6, volume: 0.47 },
  // close
  { sound: "tick", at: at("close", "command") - 10, volume: 0.68 },
  // a soft swish into each scene after the first
  ...SCENES.slice(1).map((scene) => ({ sound: "whoosh" as const, at: scene.from - 6, volume: 0.48 })),
];

// The score: one cue per part of the story, crossfaded at the seams (equal power, so the level holds through
// the handover). It sits a little lower whenever someone is speaking and comes up in the pauses between lines.
const GAPS = 0.24;
const UNDER_VOICE = 0.135;
const DUCK_IN = 10; // frames to dip before a line starts
const DUCK_OUT = 16; // frames to come back up after it ends

const LINES = SCENES.flatMap((scene) =>
  scene.voice.map((voice) => [scene.from + voice.at, scene.from + segmentEnd(voice.segment)] as const),
);

function voiceAt(frame: number) {
  let k = 0;
  for (const [start, end] of LINES) {
    const v = interpolate(frame, [start - DUCK_IN, start, end, end + DUCK_OUT], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    k = Math.max(k, v);
  }
  return k;
}

function Cue({ cue, index }: { cue: (typeof MUSIC.cues)[number]; index: number }) {
  const from = Math.round(cue.from * FPS);
  const length = Math.round(cue.length * FPS);
  const fade = Math.round(MUSIC.crossfade * FPS);
  const first = index === 0;
  return (
    <Sequence from={from} durationInFrames={length} name={`music ${cue.id}`}>
      <Audio
        src={staticFile(`audio/music/${cue.id}.wav`)}
        volume={(frame) => {
          const fadeIn = first ? Math.min(1, frame / FPS) : Math.sin((Math.PI / 2) * Math.min(1, frame / fade));
          const fadeOut = cue.ending
            ? interpolate(frame, [length - 1.5 * FPS, length], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
            : Math.cos((Math.PI / 2) * Math.max(0, Math.min(1, (frame - (length - fade)) / fade)));
          const level = mix(GAPS, UNDER_VOICE, voiceAt(from + frame));
          return fadeIn * fadeOut * level;
        }}
      />
    </Sequence>
  );
}

function Score() {
  return (
    <>
      {MUSIC.cues.map((cue, index) => (
        <Cue key={cue.id} cue={cue} index={index} />
      ))}
    </>
  );
}

export function Launch() {
  return (
    <AbsoluteFill className="film iso" data-theme="light">
      {SCENES.map((scene, index) => {
        const View = VIEWS[scene.id];
        return (
          <Sequence key={scene.id} from={scene.from} durationInFrames={scene.duration} name={scene.id}>
            <Frame duration={scene.duration} first={index === 0} last={index === SCENES.length - 1}>
              <View />
            </Frame>
            {scene.voice.map((voice) => (
              <Sequence key={voice.segment} from={voice.at} name={`vo ${voice.segment}`}>
                <Audio src={staticFile(`audio/vo/${voice.segment}.mp3`)} />
              </Sequence>
            ))}
          </Sequence>
        );
      })}
      <Score />
      {HITS.map((hit, index) => (
        <Sequence key={index} from={Math.max(0, hit.at)} durationInFrames={hit.length} name={`sfx ${hit.sound}`}>
          <Audio src={staticFile(`audio/sfx/${hit.sound}.mp3`)} volume={hit.volume} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}

