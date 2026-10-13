"use client";

import * as React from "react";
import { DARK, KEY } from "@/lib/theme";

type Choice = "system" | "light" | "dark";

const CHOICES: { value: Choice; label: string; icon: React.ReactNode }[] = [
  {
    value: "system",
    label: "System",
    icon: (
      <>
        <rect x="2.5" y="3" width="11" height="7.5" rx="1.5" />
        <path d="M6 13h4M8 10.5V13" />
      </>
    ),
  },
  {
    value: "light",
    label: "Light",
    icon: (
      <>
        <circle cx="8" cy="8" r="2.8" />
        <path d="M8 1.8v1.4M8 12.8v1.4M1.8 8h1.4M12.8 8h1.4M3.6 3.6l1 1M11.4 11.4l1 1M3.6 12.4l1-1M11.4 4.6l1-1" />
      </>
    ),
  },
  {
    value: "dark",
    label: "Dark",
    icon: <path d="M13 9.6A5.4 5.4 0 0 1 6.4 3a5.4 5.4 0 1 0 6.6 6.6Z" />,
  },
];

function read(): Choice {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function apply(choice: Choice) {
  const dark = choice === "dark" || (choice === "system" && window.matchMedia(DARK).matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function ThemeSwitch() {
  const [choice, setChoice] = React.useState<Choice>("system");

  React.useEffect(() => setChoice(read()), []);

  React.useEffect(() => {
    apply(choice);
    if (choice !== "system") return;
    const query = window.matchMedia(DARK);
    const follow = () => apply("system");
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, [choice]);

  const pick = (next: Choice) => {
    setChoice(next);
    try {
      if (next === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {}
  };

  return (
    <div className="theme" role="radiogroup" aria-label="Theme">
      {CHOICES.map(({ value, label, icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={choice === value}
          aria-label={label}
          title={label}
          className="theme-option"
          onClick={() => pick(value)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            {icon}
          </svg>
        </button>
      ))}
    </div>
  );
}
