// Renders still frames for review: node scripts/stills.mjs <outdir> <frame> [frame…]  (frames may be "scene:offsetSeconds")
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const [out, ...frames] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const root = path.resolve(new URL("..", import.meta.url).pathname);
const here = (name) => path.join(root, "node_modules", name);
const serveUrl = await bundle({
  entryPoint: path.join(root, "src/index.ts"),
  webpackOverride: (config) => ({ ...config, resolve: { ...config.resolve, alias: { ...(config.resolve?.alias ?? {}), react: here("react"), "react-dom": here("react-dom") } } }),
});
const browser = await openBrowser("chrome");
const composition = await selectComposition({ serveUrl, id: "Launch", puppeteerInstance: browser });
console.log("duration", composition.durationInFrames, "frames", (composition.durationInFrames / composition.fps).toFixed(1), "s");
for (const frame of frames) {
  const n = Number(frame);
  const file = path.join(out, `f${String(n).padStart(5, "0")}.png`);
  await renderStill({ serveUrl, composition, frame: n, output: file, puppeteerInstance: browser, scale: Number(process.env.SCALE ?? 0.5) });
  console.log(file);
}
await browser.close({ silent: true });
