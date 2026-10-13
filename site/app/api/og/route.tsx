import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// The share image: the bench (a capture of the real drawing) with the wordmark, a title and the install
// command drawn over it. Any page can pass its own words: /api/og?title=…&subtitle=…

const SIZE = { width: 1200, height: 630 };
const TITLE = "Let Claude Code and Codex";
const SUBTITLE = "talk to each other.";
const INK = "#18181a";
const SOFT = "#8c8c90";
const CLAY = "#d4683f";

// Read once per server instance, not per request (the assets never change).
const assets = Promise.all([
  readFile(join(process.cwd(), "assets/og/bench.png")),
  readFile(join(process.cwd(), "assets/og/Geist-SemiBold.ttf")),
  readFile(join(process.cwd(), "assets/og/GeistMono-Medium.ttf")),
]);

const clip = (value: string | null, fallback: string, most = 48) => {
  const text = (value ?? "").trim();
  return text ? (text.length > most ? `${text.slice(0, most - 1)}…` : text) : fallback;
};

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const custom = params.has("title");
  const title = clip(params.get("title"), TITLE);
  const subtitle = custom ? clip(params.get("subtitle"), "") : SUBTITLE;
  const [bench, sans, mono] = await assets;
  const longest = Math.max(title.length, subtitle.length);
  const size = longest > 30 ? 48 : 58;

  return new ImageResponse(
    (
      <div style={{ position: "relative", display: "flex", width: "100%", height: "100%", background: "#f2f2ef" }}>
        <img
          src={`data:image/png;base64,${bench.toString("base64")}`}
          width={SIZE.width}
          height={SIZE.height}
          style={{ position: "absolute", top: 0, left: 0 }}
          alt=""
        />
        <div style={{ position: "absolute", top: 64, left: 72, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", fontFamily: "Geist Mono", fontSize: 24, color: INK, letterSpacing: "-0.02em" }}>
            huddle
            <div style={{ width: 13, height: 26, marginLeft: 4, borderRadius: 2, background: CLAY }} />
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              marginTop: 44,
              fontFamily: "Geist",
              fontSize: size,
              lineHeight: 1.02,
              letterSpacing: "-0.05em",
              color: INK,
            }}
          >
            <span>{title}</span>
            {subtitle ? <span style={{ color: SOFT }}>{subtitle}</span> : null}
          </div>
          <div
            style={{
              display: "flex",
              alignSelf: "flex-start",
              marginTop: 34,
              padding: "12px 18px",
              border: "1px solid #e2e2df",
              borderRadius: 10,
              background: "#fbfbfa",
              fontFamily: "Geist Mono",
              fontSize: 18,
              color: INK,
            }}
          >
            <span style={{ color: SOFT, marginRight: 12 }}>$</span>
            curl -fsSL huddle.top/install | sh
          </div>
        </div>
      </div>
    ),
    {
      ...SIZE,
      fonts: [
        { name: "Geist", data: sans, weight: 600, style: "normal" },
        { name: "Geist Mono", data: mono, weight: 500, style: "normal" },
      ],
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" },
    },
  );
}
