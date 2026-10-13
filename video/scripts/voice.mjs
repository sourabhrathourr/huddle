// Generates the voiceover, one file per segment, with word timings the video cues from.
// A segment is only re-spoken when its text, voice, model or settings change, so iterating costs nothing extra.
// Usage: node scripts/voice.mjs [--force] [--voice <id>] [--only <segment id>]
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
};
const force = args.includes("--force");
const only = flag("--only");

const key = (process.env.ELEVENLABS_API_KEY ?? readFileSync(join(homedir(), ".config/elevenlabs/key"), "utf8")).trim();
const narration = JSON.parse(readFileSync(join(ROOT, "narration.json"), "utf8"));
const voice = flag("--voice") ?? narration.voice.id;
const timingPath = join(ROOT, "src/vo.json");
const timing = existsSync(timingPath) ? JSON.parse(readFileSync(timingPath, "utf8")) : {};

// Words with start and end seconds, from the character alignment.
function wordsOf(alignment) {
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  const words = [];
  let current = null;
  characters.forEach((char, index) => {
    if (/\s/.test(char)) {
      current = null;
      return;
    }
    if (!current) {
      current = { w: "", start: starts[index], end: ends[index] };
      words.push(current);
    }
    current.w += char;
    current.end = ends[index];
  });
  return words;
}

const segments = narration.segments;
for (const [index, segment] of segments.entries()) {
  if (only && segment.id !== only) continue;
  const hash = createHash("sha1")
    .update(JSON.stringify([segment.text, voice, narration.model, narration.settings]))
    .digest("hex")
    .slice(0, 12);
  const file = join(ROOT, `public/audio/vo/${segment.id}.mp3`);
  if (!force && timing[segment.id]?.hash === hash && existsSync(file)) {
    console.log(`skip  ${segment.id}`);
    continue;
  }
  const body = {
    text: segment.text,
    model_id: narration.model,
    voice_settings: narration.settings,
    previous_text: segments[index - 1]?.text,
    next_text: segments[index + 1]?.text,
  };
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`,
    { method: "POST", headers: { "xi-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  if (!response.ok) {
    console.error(`fail  ${segment.id}: ${response.status} ${await response.text()}`);
    process.exit(1);
  }
  const data = await response.json();
  writeFileSync(file, Buffer.from(data.audio_base64, "base64"));
  const alignment = data.normalized_alignment ?? data.alignment;
  const words = wordsOf(data.alignment);
  const duration = alignment.character_end_times_seconds.at(-1);
  timing[segment.id] = { hash, duration, words };
  console.log(`spoke ${segment.id}  ${duration.toFixed(2)}s  ${segment.text.length} chars`);
}

writeFileSync(timingPath, `${JSON.stringify(timing, null, 1)}\n`);
const total = segments.reduce((sum, segment) => sum + (timing[segment.id]?.duration ?? 0), 0);
console.log(`total speech ${total.toFixed(1)}s`);
