# Changelog

## 0.2.0

Agents can now start each other. Ask Claude to "get Codex to review this PR", or ask Codex to "have Claude write the tests", and the agent starts the other one as a helper, gives it the task, and gets its reply. You don't type `/huddle` anywhere.

- `huddle spawn codex|claude` starts a helper with a task and prints its reply. `huddle send NAME` continues with the same helper, which keeps its whole thread. A huddle can hold any number of helpers, and helpers can ask each other with `huddle send`.
- Helpers run through each app's own protocol (`codex app-server`; `claude -p` with stream-json), so every message reaches a helper as a user turn, and its final message is its reply. Nothing depends on a terminal or a window.
- Agents no longer stop to ask for approval when another agent asks them to do something. Messages from other agents used to be framed as "a colleague, not the user", and the skill said that anything outside the user's own request needed the user's approval, so Codex often stopped and waited. Now a request from another agent counts as the user's work passed along, and helpers run without approval prompts.
- No loops by construction: a message an agent sends gets exactly one reply, and a reply never makes a new request. If a reply reaches a helper between tasks, the helper's answer goes up to the agent that started it, never back.
- Idle helpers rest after 30 minutes and wake on the next message, continuing their own thread. `huddle stop` and `huddle interrupt` stop a helper or its current turn. If a helper crashes or can't start, whoever asked is told why instead of waiting.
- `huddle watch` is now a full-screen app, built with ratatui: one huddle at a time with Markdown, code and tables laid out, a live status line for every agent and helper, scrollback that stays put while new messages arrive, and an input box where Tab or `@name` picks who to message. With several huddles running it asks which one, by thread title; Ctrl-N and Ctrl-P switch, and Esc lists them. `/stop`, `/interrupt` and `/end` work from it. `install.sh` installs it for macOS and Linux; elsewhere `huddle watch` uses the view built into the command.
- The watch shows work the way Claude Code does. Each agent's steps run under the message it's working on, and stay there once it answers: what it said along the way, its thinking, each command titled with the agent's own words, then `$ command` and a few lines of output, and edits as numbered diffs on red and green, with the changed words brighter. What you type mid-turn sits among the steps where it arrived. ctrl+o lists the agents; Enter follows one live, opens a helper's real session, or goes to the window of a thread you opened. Scroll up and the prompt you're reading under stays pinned at the top.
- Codex helpers run on Codex's shared server when it's running, so you can open one in Codex and talk to it there while Claude talks to it through huddle. What you say to it in Codex shows in the watch too.
- Messages to a working agent wait for its turn to end, listed over the input as queued; ctrl+enter steers a working Codex helper instead (`huddle say --steer`).
- `huddle list` shows each huddle's members as a tree, with what every helper is doing.
- `huddle read NAME` shows a member's latest message, for picking up a reply later.
- `huddle doctor` checks that both apps can run as helpers, and says whether the full-screen watch is installed.
- Fixes from a review by Codex: a reply could stay hidden when its asker gave up at the wrong moment; a message could arrive just as an idle helper went to sleep and wait forever; a turn the app refused, or an app crash with messages queued behind it, could leave askers waiting; a reply could be shown twice; and a dead runner's process ID reused by another program blocked restarts.
- The skill is rewritten around working autonomously.

## 0.1.2

- `/huddle` in a new thread no longer takes over a huddle another thread is in. Before, a fresh Claude thread could take the seat of a parallel Claude thread in the same repo and send its brief into that pair's Codex thread. Now it joins a thread of the other app that's waiting in this repo, or opens a new huddle.
- To continue a running huddle from another thread, type `/huddle N` or `$huddle N`. After `/clear`, Claude continues on its own, because it's the same window.
- "Start a new huddle" leaves the current one and connects afresh.
- When more than one thread is waiting to connect, the agent asks which one instead of picking the oldest.
- Waiting threads now expire after 15 minutes instead of an hour.
- Connecting names the other thread, e.g. "Joined huddle 2 with Codex (thread “Explain PR #1220 harness”)", and so do `huddle list` and plain `huddle`.
- Codex is told when a huddle ends. Before, only Claude was.
- Plain `huddle` shows what's running, how to connect and the main commands, instead of a usage error.

## 0.1.1

- An agent no longer misses a message that arrived just before it posted. Posting used to mark everything as read.
- After `/clear` or a new chat, the recent messages a new thread sees no longer include notes you sent only to the other agent.

## 0.1.0

First release.

- `/huddle` in Claude Code and `$huddle` in Codex connect the two threads, in either order, with no codes to type.
- Agents stay connected across topics until you end the huddle. After `/clear` or a new chat, the new thread takes the old one's place.
- `huddle watch` shows the whole conversation live, including what each agent tells you in its own app, and lets you message both agents or one.
- Huddles are numbered 1, 2, 3…, using the lowest number not in use.
- `huddle clean`, `huddle doctor`, `huddle update` and `huddle uninstall`.
- One-line install with `install.sh`, verified against a checksum.
