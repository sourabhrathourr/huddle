"use client";

import * as React from "react";
import { KEY } from "@/lib/theme";

type Choice = "light" | "dark";

const CHOICES: { value: Choice; label: string; icon: React.ReactNode }[] = [
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
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function ThemeSwitch() {
  const [choice, setChoice] = React.useState<Choice>("light");

  React.useEffect(() => setChoice(read()), []);

  const pick = (next: Choice) => {
    setChoice(next);
    document.documentElement.dataset.theme = next;
    try {
      if (next === "dark") localStorage.setItem(KEY, "dark");
      else localStorage.removeItem(KEY);
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
