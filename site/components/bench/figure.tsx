import { BenchArt, LABEL } from "./art";
import { BenchLive } from "./live";
import { HEIGHT, WIDTH } from "./view";
import "./bench.css";

// The bench in its card: it plays the huddle on a loop, with no controls and no labels.
export function BenchFigure() {
  return (
    <BenchLive>
      <div className="bn-card">
        <svg className="iso-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={LABEL} focusable="false">
          <BenchArt />
        </svg>
      </div>
    </BenchLive>
  );
}
