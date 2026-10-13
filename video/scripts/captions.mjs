// Writes WebVTT captions for the film from the voice's word timings, one cue per sentence (long ones split).
// Usage: node scripts/captions.mjs <out.vtt>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const FPS = 30;
const read = (file) => JSON.parse(readFileSync(join(ROOT, file), "utf8"));
const timeline = read("timeline.json");
const vo = read("src/vo.json");
const out = process.argv[2] ?? join(ROOT, "out/huddle-launch.en.vtt");

// Words with absolute times, laid out exactly as src/lib.ts lays out the scenes (whole frames).
const f = (seconds) => Math.round(seconds * FPS);
const words = [];
let total = 0;
for (const scene of timeline.scenes) {
  let t = 0;
  for (const { segment, lead } of scene.voice) {
    t += lead;
    const start = (total + f(t)) / FPS;
    for (const word of vo[segment].words) words.push({ w: word.w, start: start + word.start, end: start + word.end });
    t += vo[segment].duration;
  }
  total += f(t + scene.tail);
}

const cues = [];
let current = [];
const flush = () => {
  if (current.length) cues.push(current);
  current = [];
};
for (const word of words) {
  current.push(word);
  const text = current.map((w) => w.w).join(" ");
  if (/[.?!]$/.test(word.w) || (/,$/.test(word.w) && text.length > 42) || text.length > 64) flush();
}
flush();

// Very short sentences ("Copy." "Paste.") would flash by one at a time; run them together into one cue.
for (let i = 0; i < cues.length - 1; i++) {
  const text = (cue) => cue.map((w) => w.w).join(" ");
  if (text(cues[i]).length < 26 && text(cues[i + 1]).length < 16) {
    cues.splice(i, 2, [...cues[i], ...cues[i + 1]]);
    i -= 1;
  }
}

const stamp = (s) => {
  const ms = Math.round(s * 1000);
  const hh = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const mm = String(Math.floor(ms / 60000) % 60).padStart(2, "0");
  const ss = String(Math.floor(ms / 1000) % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}.${String(ms % 1000).padStart(3, "0")}`;
};
const body = cues
  .map((cue, index) => {
    const next = cues[index + 1];
    const end = Math.min(cue.at(-1).end + 0.6, next ? next[0].start - 0.05 : Infinity);
    return `${stamp(cue[0].start)} --> ${stamp(end)}\n${cue.map((w) => w.w).join(" ")}`;
  })
  .join("\n\n");
writeFileSync(out, `WEBVTT\n\n${body}\n`);
console.log(`${cues.length} cues → ${out}`);
