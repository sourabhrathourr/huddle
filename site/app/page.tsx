import type * as React from "react";
import { BenchFigure } from "@/components/bench/figure";
import { HuddleWordmark } from "@/components/brand";
import { Command } from "@/components/copy";
import { Talk } from "@/components/talk";
import { ThemeSwitch } from "@/components/theme";
import { INSTALL, REPO, VERSION } from "@/lib/site";

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "Is there a server or an account?",
    a: (
      <>
        No. Every message lives in one SQLite file, <code>~/.huddle/huddle.db</code>. There&apos;s no port, no account and no telemetry, and ended huddles are deleted after 30 days.
      </>
    ),
  },
  {
    q: "Won't they just agree with each other?",
    a: "The skill tells them not to. They push back with a file and a line, say when they've been persuaded, and close a settled question with what's agreed, what's still open and who does what next.",
  },
  {
    q: "How does one agent wake the other?",
    a: (
      <>
        Codex is woken with <code>codex queue</code>, which drops the message into its thread as if a colleague had typed it. Claude keeps one <code>huddle wait</code> running in the background, which exits the moment a message arrives.
      </>
    ),
  },
  {
    q: "Who's in charge?",
    a: "You are. Talk to either agent at any time and your message comes first. What one agent tells the other is input, not orders: anything you didn't ask for still needs your yes.",
  },
  {
    q: "Can I run more than one?",
    a: (
      <>
        Yes. Parallel threads in one repo each get their own huddle. After <code>/clear</code>, <code>/huddle</code> carries on with the same one; from any other thread, name it: <code>/huddle 2</code>.
      </>
    ),
  },
  {
    q: "What if an update breaks it?",
    a: (
      <>
        huddle relies on parts of Claude Code and Codex that aren&apos;t public APIs. Run <code>huddle doctor</code> first, then <a href={`${REPO}/issues`}>open an issue</a>.
      </>
    ),
  },
];

export default function Home() {
  return (
    <>
      <header className="top">
        <a className="brand" href="#">
          <HuddleWordmark />
        </a>
        <nav>
          <a href="#how">How it works</a>
          <a href="#install">Install</a>
          <a href={REPO} className="nav-gh">
            GitHub ↗
          </a>
          <ThemeSwitch />
        </nav>
      </header>

      <main>
        {/* Layout: "hero split" is left-aligned on the page grid. Change to "hero" for the centered version. */}
        <section className="hero split">
          <p className="eyebrow">A skill and CLI for Claude Code and Codex</p>
          <h1>
            Let Claude Code and Codex
            <br />
            <span className="soft">talk to each other.</span>
          </h1>
          <p className="lede">
            Type <code>/huddle</code> in one and <code>$huddle</code> in the other. The two agents connect, review each other&apos;s work, argue it out with file and line, and agree on a plan. You watch, and step in whenever you like.
          </p>
          <div className="install">
            <Command text={INSTALL} />
          </div>
        </section>

        <section className="hero-figure" aria-label="How a huddle runs">
          <BenchFigure />
        </section>

        <section className="section" id="how">
          <div className="section-head">
            <p className="eyebrow">How it works</p>
            <h2>
              Two apps. <span className="soft">One conversation.</span>
            </h2>
          </div>

          <div className="bento">
            <article className="tile tile-talk">
              <Talk />
              <div className="tile-copy">
                <h3>They push back. Then they agree.</h3>
                <p>Claude and Codex come from different labs, with different blind spots. Each says when the other is wrong, says why, and says when it&apos;s been persuaded.</p>
              </div>
            </article>

            <article className="tile tile-connect">
              <div className="tile-visual connect">
                <span className="key">
                  <code>/huddle</code>
                  <small>in Claude Code</small>
                </span>
                <span className="plus" aria-hidden="true">
                  +
                </span>
                <span className="key">
                  <code>$huddle</code>
                  <small>in Codex</small>
                </span>
              </div>
              <div className="tile-copy">
                <h3>Two commands. No codes.</h3>
                <p>Each agent is known by its own thread, so you never type a name or an ID. Connect once; they stay connected until you end it.</p>
              </div>
            </article>



            <article className="tile tile-watch">
              <div className="tile-visual watch" aria-hidden="true">
                <p>
                  <i className="dot dot-codex" />
                  <b>Codex</b> <em>to Claude</em>
                </p>
                <p className="watch-body">runner.py:88 retries jobs that already committed.</p>
                <p>
                  <i className="dot dot-claude" />
                  <b>Claude</b> <em>to you</em>
                </p>
                <p className="watch-body">We agree on one bug and its fix. Should I make it?</p>
                <p className="watch-prompt">
                  <b>to both ›</b> message both agents · Tab to pick one
                </p>
              </div>
              <div className="tile-copy">
                <h3>Watch, and step in</h3>
                <p>
                  <code>huddle watch</code> follows the conversation live in a spare terminal and lets you message both agents or one. Your message always comes first.
                </p>
              </div>
            </article>


          </div>
        </section>

        <section className="section" id="faq">
          <div className="section-head">
            <p className="eyebrow">Questions</p>
            <h2>
              Good to know. <span className="soft">Before you install.</span>
            </h2>
          </div>
          <dl className="faq">
            {FAQ.map((item) => (
              <div key={item.q} className="faq-row">
                <dt>{item.q}</dt>
                <dd>{item.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="section closing" id="install">
          <h2>
            Get them talking. <span className="soft">One command.</span>
          </h2>
          <p className="closing-lede">
            Installs the <code>huddle</code> CLI and the skill both apps load, after checking the download&apos;s checksum. Run it again to upgrade.
          </p>
          <div className="closing-command">
            <Command text={INSTALL} />
          </div>
          <p className="closing-note">
            macOS or Linux (Windows via WSL), Python 3.9+, git, Claude Code and Codex. <code>huddle doctor</code> checks your setup, and every command is in the <a href={REPO}>README</a>.
          </p>
        </section>
      </main>

      <footer className="foot">
        <span>
          huddle {VERSION} · MIT · <a href={REPO}>GitHub</a>
        </span>
        <span>One Python file, standard library only.</span>
      </footer>
    </>
  );
}
