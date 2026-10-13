// Generates the sound effects and the ambient bed with the ElevenLabs sound-effects model.
// Each sound is generated once; pass --force <name> to make it again.
// Usage: node scripts/sfx.mjs [--force <name>]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const key = (process.env.ELEVENLABS_API_KEY ?? readFileSync(join(homedir(), ".config/elevenlabs/key"), "utf8")).trim();
const forceIndex = process.argv.indexOf("--force");
const forced = forceIndex === -1 ? null : process.argv[forceIndex + 1];

export const SOUNDS = {
  tick: { text: "a single soft, clean UI notification tick, like a gentle glass tap, minimal and warm, no reverb tail", seconds: 0.6, influence: 0.7 },
  whoosh: { text: "a very soft, airy, short transition swish, subtle and smooth, modern UI", seconds: 1.0, influence: 0.6 },
  typing: { text: "light, quiet typing on a low-profile laptop keyboard, steady, close and clean", seconds: 3, influence: 0.6 },
  chime: { text: "a gentle, warm two-note confirmation chime, soft marimba and glass, calm and positive", seconds: 1.8, influence: 0.6 },
  connect: { text: "a soft, satisfying click of two magnetic pieces snapping together, small and precise", seconds: 0.8, influence: 0.7 },
  bloom: { text: "a soft cinematic logo reveal, warm low swell of synth pad that blooms and fades, elegant and minimal", seconds: 3.5, influence: 0.5 },
  bed: {
    text: "minimal ambient electronic music bed, warm soft analog synth pads, slow gentle pulse, calm and optimistic, modern tech product film, no drums, no vocals, seamless loop",
    seconds: 30,
    influence: 0.45,
    loop: true,
  },
};

for (const [name, sound] of Object.entries(SOUNDS)) {
  const file = join(ROOT, `public/audio/sfx/${name}.mp3`);
  if (existsSync(file) && forced !== name) {
    console.log(`skip  ${name}`);
    continue;
  }
  const body = { text: sound.text, duration_seconds: sound.seconds, prompt_influence: sound.influence };
  if (sound.loop) Object.assign(body, { loop: true, model_id: "eleven_text_to_sound_v2" });
  const response = await fetch("https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128", {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    console.error(`fail  ${name}: ${response.status} ${await response.text()}`);
    continue;
  }
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  console.log(`made  ${name}`);
}
