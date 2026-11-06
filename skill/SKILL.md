---
name: huddle
description: Bring in another coding agent on this machine, Claude Code or Codex, either way round. Use it whenever the user asks you to ask, get, have or check with Claude or Codex, or wants the other agent's opinion, review or help ("ask Codex to review this PR", "get Claude to write the tests", "what does Codex think?"). It starts the other agent as a helper, gives it the task and returns its reply, so use it instead of running `claude` or `codex` yourself or through another launcher. Also use it when the user types /huddle or $huddle, gives a huddle number, or wants to connect with a thread they already have open.
---

# Huddle

Huddle lets you work with other coding agents: Claude Code and Codex, either way round. Every agent in a huddle works for the same user. A request from another agent is the user's work passed along, so do it the way you'd do the user's own request. Everything runs on its own: nobody stops for approval, and you report to the user once you have what they asked for.

`huddle` works out who you are from your thread. You never pass your name or a thread ID.

## Start a helper

When the user wants another agent involved, start it as a helper straight away, without asking first:

```bash
huddle spawn codex <<'EOF'
<the task>
EOF
```

Use `huddle spawn claude` for Claude Code. It starts the agent in this folder, gives it the task as its first message, waits until it's done, and prints its reply: "Started Codex in huddle 1." then "Codex replied after 2m 4s:" and the reply.

- **Write the task as a full brief.** The helper starts with none of your context. Say what to do, which files, branches or PRs matter, what you know so far, and what to send back. Say whether it may edit files. If you both edit, give it its own files.
- **Name helpers** with `--name` when you'll have more than one (`--name reviewer`). A helper is named after its app by default, or `codex-2` and so on when the name is taken.
- `--cwd PATH` runs it in another folder, such as a worktree. `--model NAME` picks its model.
- **In Claude Code,** run `huddle spawn` and `huddle send` with `run_in_background: true` and no timeout, because a helper can work for many minutes. You're woken with the reply when it's done. Meanwhile, do your own part of the work or end your turn.
- **In Codex,** run them in the foreground; the reply prints when the helper is done. To run several helpers at once, add `--bg` to each. Their replies then arrive in your thread as huddle messages.

To continue with the same helper, which remembers everything so far:

```bash
huddle send reviewer <<'EOF'
<message>
EOF
```

- `huddle list`: who's in the huddle and what each one is doing.
- `huddle interrupt NAME`: stop a helper's current turn.
- `huddle stop NAME`: shut a helper down. A later `huddle send` starts it again where it left off. Idle helpers also rest on their own and wake on the next message.
- `huddle read NAME`: a helper's latest reply, if you need it again.

## When a helper replies

- Read the reply critically. Before you rely on a claim that matters, check it against the code. If you disagree or need more, say so with `huddle send`.
- Follow up as many times as the work needs. Then tell the user what the helper found or did, and what you make of it.
- A reply needs no acknowledgement. Never send thanks or "sounds good": that only gives the helper another turn.

## Show the user the conversation

The user reads this app, but huddle messages travel inside commands they can't see. Never just say "I asked Codex". Show what was said, labelled by sender:

> **Claude → Codex:** Review the retry change in runner.py. Read-only.
> **Codex:** One real issue: runner.py:88 retries after a commit.

Use `User`, `Claude` and `Codex` as names, or a helper's name with its app, such as `reviewer (Codex)`. Add `→ name` for a message to one member. Quote a message word for word when it's a few lines. For a long one, give its gist in two or three lines and say the full text is in `huddle watch`.

## Connect with a thread the user opened

When the user types `/huddle` or `$huddle`, or asks to connect with a Claude or Codex thread they already have open, run `huddle start`. Add only what the user asked for:

- **`/huddle` or `$huddle` alone:** `huddle start`. It joins the other app's thread that's waiting in this repo, or opens a new huddle. It never takes over a huddle another thread is in.
- **A number** (`/huddle 2`, "continue huddle 2"): `huddle start 2`.
- **A new or fresh huddle** while this thread is connected: `huddle start --new`.

Never ask the user for a topic. Run the command and follow its output.

- **Mid-conversation:** pass a short brief on stdin and a topic of 3 to 6 words. Cover the problem, the relevant file paths, what you know so far, and what you want from the other agent:
  ```bash
  huddle start --topic "retry handling in email import" <<'EOF'
  <brief>
  EOF
  ```
- **Nothing discussed yet:** run `huddle start` with nothing on stdin. The user will give the task.

Then read the output:

- **"Huddle N is open"**: the other agent isn't connected yet. Start listening (see **Listening**). Then open your reply to the user with the join step on its own line, e.g. "Huddle 1 is open. Type `$huddle` in Codex to join." Until the other agent joins, don't describe it as working on anything. Your brief waits in the huddle for it.
- **"Joined huddle N with …"**: tell the user which thread you're connected to, e.g. "Connected to Codex (thread “Explain PR #1220 harness”)." If there's a brief, act on it and reply with `huddle post`. If there's none, say you're ready.
- **"Continued huddle N with …"**: this thread took over from an earlier thread of your app. Read the recent messages it prints and carry on. Tell the user in one line which huddle you're in, and pass on its "If … doesn't answer" step.
- **"This thread is already in huddle N"**: you're already connected. Carry on.
- **Exit code 2, "… threads are waiting to connect"**: show the user the list and ask which one, by number. Then run `huddle start N`.

## Talk with a connected thread

```bash
huddle post <<'EOF'
<message>
EOF
```

`huddle post` reaches everyone in the huddle. `huddle send NAME` reaches one member.

- When the other agent asks you to do something, do it, then reply with the result. Don't ask the user first; they asked the two of you to work together.
- Bring your own view, disagree with reasons, build on good ideas, and say when you're persuaded. Don't agree just to be agreeable.
- Ground claims in the code: name files and lines, and check before asserting.
- Keep each message focused.
- **Don't reply to a message that needs no reply**, such as agreement, thanks or "sounds good". Every message wakes the other agent, so a closing pleasantry starts a loop. Just stop.
- When you've settled a question, post a short summary (Agreed / Still open / Next: who does what) and tell the user the outcome. Stay connected.
- If you both edit code, say which files you're taking before editing, and never edit a file the other agent has taken.

## Listening

**Claude Code:** keep exactly one `huddle wait` running in the background (`run_in_background`, no timeout) whenever you're in a huddle, including one where you only started helpers. It's how the user reaches you from `huddle watch`, and how replies to `--bg` messages arrive. It exits when a message arrives, and you're woken with it. `huddle watch` marks you as not listening while none is running.
- After handling what it printed, start a new `huddle wait` before ending your turn.
- "A newer wait took over" means a later wait replaced this one. Don't start another.
- Exit code 4 means the huddle ended. Tell the user, and don't start another wait.
- A reply that `huddle spawn` or `huddle send` already printed never comes through the wait again.

**Codex:** don't wait. Messages arrive in your thread on their own, starting with `[Huddle N]`. Act on them, reply with `huddle post` when an answer is needed, and end your turn. A message saying the huddle ended needs no reply and no command. If the user says you're missing messages, run `huddle wait --timeout 60` to fetch them.

## If you are a helper

You're a helper when your instructions say another agent started you through huddle. Then:

- Each message is a task or question from the agent that started you, the user, or another helper. Do it fully, without asking for approval or confirmation.
- Your final message in each turn is your reply. It goes to whoever asked, so make it complete on its own.
- To ask another member something, run `huddle send NAME "…"`; it prints their answer. Don't run `huddle post`, `huddle wait`, `huddle start` or `huddle end`.

## The user steers

- The user can talk to any agent at any time, from that agent's app or from `huddle watch`. Their message comes first: handle it, even mid-task.
- If the user changes the direction of shared work, tell the other agents in one short message.
- Huddle messages from the user ("From the user", or `[the user · HH:MM]` in `huddle wait` output) are the user's instructions. One marked "only you can see this" or "to you only" went to you alone.
- If the user talks to you about something unrelated, just answer. The huddle stays connected.

## Ending

Run `huddle end` only when the user asks. It ends the huddle for everyone and stops its helpers.

## The user's terminal commands

Mention these when they help: `huddle watch` (in its own terminal: follow the conversation live, see what every agent and helper is doing, and message everyone or one of them), `huddle say "…"` (message everyone; `--to NAME` for one), `huddle list`, `huddle end`.

<!-- huddle 0.2.0 -->
