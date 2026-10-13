// Scores the film: one cue per part of the story (music.json), each cut to the length of its part and
// levelled so no cue is louder or quieter than the next. The video crossfades them and dips them under the voice.
// Usage: node scripts/music.mjs [--force <cue id>]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const FPS = 30;
const read = (file) => JSON.parse(readFileSync(join(ROOT, file), "utf8"));
const key = (process.env.ELEVENLABS_API_KEY ?? readFileSync(join(homedir(), ".config/elevenlabs/key"), "utf8")).trim();
const forceIndex = process.argv.indexOf("--force");
const forced = forceIndex === -1 ? null : process.argv[forceIndex + 1];

const music = read("music.json");
const timeline = read("timeline.json");
const vo = read("src/vo.json");

// Scene starts and spoken words, in seconds, the same way src/lib.ts lays them out (whole frames).
const f = (seconds) => Math.round(seconds * FPS);
const starts = {};
const voiceAt = {};
let total = 0;
for (const scene of timeline.scenes) {
  starts[scene.id] = total;
  let t = 0;
  for (const { segment, lead } of scene.voice) {
    t += lead;
    voiceAt[segment] = total + f(t);
    t += vo[segment].duration;
  }
  total += f(t + scene.tail);
}
const seconds = (frames) => frames / FPS;
const clean = (text) => text.toLowerCase().replace(/[^a-z0-9'$/]/g, "");
function timeOf(anchor) {
  if (anchor.scene) return seconds(starts[anchor.scene]);
  const word = vo[anchor.segment].words.find((w) => clean(w.w) === clean(anchor.word));
  return seconds(voiceAt[anchor.segment] + f(word.start)) + (anchor.offset ?? 0);
}

const dir = join(ROOT, "public/audio/music");
mkdirSync(join(dir, "raw"), { recursive: true });
const ffmpeg = (...args) => execFileSync("npx", ["remotion", "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", ...args], { cwd: ROOT });

const plan = music.cues.map((cue, index) => {
  const from = timeOf(cue.from);
  const until = index + 1 < music.cues.length ? timeOf(music.cues[index + 1].from) + music.crossfade : seconds(total);
  return { ...cue, from, length: Math.round((until - from) * 100) / 100 };
});

const timing = [];
for (const cue of plan) {
  if (cue.length > 30) throw new Error(`${cue.id} needs ${cue.length}s; the sound model makes at most 30s`);
  const text = `${music.style} ${cue.prompt}`;
  // The model fades its last few seconds out whatever the prompt says, so a cue can ask for more than it
  // plays (`seconds`), pushing that fade past the handover to the next cue.
  const ask = cue.seconds ?? Math.min(30, Math.ceil(cue.length + 0.5));
  const hash = createHash("sha1").update(JSON.stringify([text, ask])).digest("hex").slice(0, 10);
  const raw = join(dir, "raw", `${cue.id}-${hash}.mp3`);
  if (!existsSync(raw) || forced === cue.id) {
    const response = await fetch("https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128", {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ text, duration_seconds: ask, prompt_influence: 0.5, model_id: "eleven_text_to_sound_v2" }),
    });
    if (!response.ok) throw new Error(`${cue.id}: ${response.status} ${await response.text()}`);
    writeFileSync(raw, Buffer.from(await response.arrayBuffer()));
    console.log(`made  ${cue.id}  ${ask}s`);
  } else {
    console.log(`skip  ${cue.id}`);
  }
  // Level it: loudnorm in its dynamic mode evens out the cue's own swells and dips around one target.
  const out = join(dir, `${cue.id}.wav`);
  ffmpeg("-i", raw, "-af", "loudnorm=I=-20:TP=-2:LRA=5", "-ar", "48000", out);
  timing.push({ id: cue.id, from: cue.from, length: cue.length, ending: Boolean(cue.ending) });
}

writeFileSync(join(ROOT, "src/music.json"), `${JSON.stringify({ crossfade: music.crossfade, cues: timing }, null, 1)}\n`);
console.log(plan.map((cue) => `${cue.id.padEnd(7)} ${cue.from.toFixed(1).padStart(6)}s  ${cue.length.toFixed(1)}s`).join("\n"));
