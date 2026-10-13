"use client";

import * as React from "react";

export function Copy({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = React.useState(false);
  React.useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => setDone(false), 1600);
    return () => window.clearTimeout(timer);
  }, [done]);
  return (
    <button
      type="button"
      className="copy"
      data-done={done ? "" : undefined}
      aria-label={done ? "Copied" : `${label} to clipboard`}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => setDone(true), () => setDone(false));
      }}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        {done ? <path d="M3.5 8.5l3 3 6-7" /> : <><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" /></>}
      </svg>
      <span>{done ? "Copied" : label}</span>
    </button>
  );
}

export function Command({ text, prompt = "$" }: { text: string; prompt?: string }) {
  return (
    <div className="command">
      <code>
        <span className="command-prompt" aria-hidden="true">
          {prompt}
        </span>
        {text}
      </code>
      <Copy text={text} />
    </div>
  );
}
