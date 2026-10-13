import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "../components/iso/iso.css";
import "./globals.css";
import { SITE } from "@/lib/site";
import { THEME_SCRIPT } from "@/lib/theme";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

const OG_ALT = "huddle: let Claude Code and Codex talk to each other. Install with curl -fsSL huddle.top/install | sh";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: "huddle: Claude Code and Codex, talking to each other",
  description:
    "Type /huddle in Claude Code and $huddle in Codex. The two threads connect and can brainstorm, review each other's work, disagree and agree on a plan, while you watch and steer.",
  openGraph: {
    title: "huddle",
    description: "Let Claude Code and Codex talk to each other, without you copying messages between them.",
    type: "website",
    images: [{ url: "/api/og", width: 1200, height: 630, alt: OG_ALT }],
  },
  twitter: {
    card: "summary_large_image",
    title: "huddle",
    description: "Let Claude Code and Codex talk to each other, without you copying messages between them.",
    images: [{ url: "/api/og", alt: OG_ALT }],
  },
};

export const viewport: Viewport = {
  themeColor: "#f2f2ef",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`iso ${sans.variable} ${mono.variable}`} data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
