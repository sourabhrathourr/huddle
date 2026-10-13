import { continueRender, delayRender, staticFile } from "remotion";

// Geist and Geist Mono, loaded before the first frame renders.
const FONTS = [
  { family: "Geist", file: "fonts/Geist-Variable.woff2" },
  { family: "Geist Mono", file: "fonts/GeistMono-Variable.woff2" },
];

if (typeof document !== "undefined") {
  const handle = delayRender("fonts");
  Promise.all(
    FONTS.map(async ({ family, file }) => {
      const face = new FontFace(family, `url(${staticFile(file)}) format("woff2")`, { weight: "100 900" });
      document.fonts.add(await face.load());
    }),
  ).then(() => continueRender(handle));
}
