# Changelog

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
