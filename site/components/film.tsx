"use client";

import * as React from "react";
import "./film.css";

const SRC = "/film/huddle-launch.mp4";
const POSTER = "/film/poster.jpg";
const CAPTIONS = "/film/huddle-launch.en.vtt";
const LENGTH = "2:04";
const CLOSE_MS = 200; // must match the lb-out animation in film.css

// The launch film: a still from its opening, and a lightbox that plays it with sound.
// The video only starts loading when someone opens it, so the page stays light.
export function Film() {
  const dialog = React.useRef<HTMLDialogElement>(null);
  const video = React.useRef<HTMLVideoElement>(null);
  const opener = React.useRef<HTMLButtonElement>(null);
  const closing = React.useRef<number | null>(null);

  const open = () => {
    const box = dialog.current;
    if (!box || box.open) return;
    box.removeAttribute("data-closing");
    box.showModal();
    // Play inside the click itself, so browsers allow sound.
    video.current?.play().catch(() => {});
  };

  const close = React.useCallback(() => {
    const box = dialog.current;
    if (!box?.open || closing.current !== null) return;
    video.current?.pause();
    box.setAttribute("data-closing", "");
    closing.current = window.setTimeout(() => {
      closing.current = null;
      box.removeAttribute("data-closing");
      box.close();
      opener.current?.focus();
    }, CLOSE_MS);
  }, []);

  React.useEffect(() => () => {
    if (closing.current !== null) window.clearTimeout(closing.current);
  }, []);

  return (
    <>
      <button ref={opener} type="button" className="film-frame" onClick={open} aria-label={`Play the huddle film, ${LENGTH}`}>
        <img src={POSTER} alt="" width={1920} height={1080} loading="lazy" decoding="async" />
        <span className="film-play" aria-hidden="true">
          <svg viewBox="0 0 16 16">
            <path d="M5 3.4v9.2a.6.6 0 0 0 .9.5l7.4-4.6a.6.6 0 0 0 0-1L5.9 2.9a.6.6 0 0 0-.9.5z" />
          </svg>
          <span className="film-label">Watch the film</span>
          <span className="film-length">{LENGTH}</span>
        </span>
      </button>

      <dialog
        ref={dialog}
        className="lightbox"
        aria-label="The huddle film"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onKeyDown={(event) => {
          // The dialog's own cancel covers most browsers; this catches Escape wherever focus is, even on the video.
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
        }}
        onClick={(event) => {
          // A click on the dimmed backdrop (the dialog itself, not its contents) closes it.
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className="lightbox-stage" onClick={(event) => event.target === event.currentTarget && close()}>
          <video ref={video} className="lightbox-video" src={SRC} poster={POSTER} controls playsInline preload="none" width={1920} height={1080}>
            <track kind="captions" src={CAPTIONS} srcLang="en" label="English" />
          </video>
        </div>
        <button type="button" className="lightbox-close" onClick={close} aria-label="Close the film">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </dialog>
    </>
  );
}
