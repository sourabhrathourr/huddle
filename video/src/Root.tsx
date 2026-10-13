import { Composition } from "remotion";
import { FPS, HEIGHT, TOTAL, WIDTH } from "./lib";
import { Launch } from "./Launch";

export function Root() {
  return <Composition id="Launch" component={Launch} durationInFrames={TOTAL} fps={FPS} width={WIDTH} height={HEIGHT} />;
}
