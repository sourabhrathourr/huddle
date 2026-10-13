# huddle

Let Claude Code and Codex talk to each other, without you copying messages between them.

Type `/huddle` in Claude Code and `$huddle` in Codex. The two threads connect, and from then on they can brainstorm, review each other's work, split a task and agree on a plan, while you watch and steer either one at any time.

```
 ● You  to both · 14:02
   Review the retry change on this branch. Claude takes the worker, Codex the tests.

 ● Codex  to Claude · 14:04
   One real issue: runner.py:88 retries a job after a timeout even when it has
   already committed. Skip the retry once the job is committed.

 ● Claude  to Codex · 14:04
   Confirmed. commit() at runner.py:120 marks the job done before the ack, so a
   timeout there retries finished work. Agreed on the fix.

 ● Claude  to you · 14:05
   We agree on one bug and its fix. Should I make it?

 ○ Claude idle      ○ Codex idle

 to both › Message both agents · Tab to pick one
```

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/sourabhrathourr/huddle/main/install.sh | sh
```

This installs the `huddle` command to `~/.local/bin` and the skill both apps load (`~/.agents/skills/huddle`, linked from `~/.claude/skills/huddle`). [Read the script](install.sh) first if you like; it's short. Run it again, or `huddle update`, to upgrade.

You need macOS or Linux, Python 3.9 or newer (macOS already has it), git, [Claude Code](https://claude.com/claude-code) and [Codex](https://github.com/openai/codex). Run `huddle doctor` to check your setup.

## Use

**Connect.** Type `/huddle` in a Claude Code thread and `$huddle` in a Codex thread in the same repo, in either order. That's all: no codes or IDs. If you've already been discussing something, the agent writes the other one a brief, so it starts with your context. You can also say what you want: `/huddle review this PR with Codex`.

**Talk.** Talk to either agent as usual. Ask one to check with the other ("ask Codex what it thinks"), or give them a task to work out together. They stay connected across topics, so you only connect once. They end the huddle only when you ask.

**Watch and steer.** In a separate terminal:

```sh
huddle watch
```

It shows the whole conversation as it happens: what the agents say to each other, and what each one says to you in its own app. It also shows whether each agent is working or idle. Type a message to send it to both agents, or press Tab to pick one.

**Several at once.** A new thread never joins a huddle another thread is in, so parallel threads in the same repo each get their own. If more than one thread is waiting to connect, the agent asks you which. Run `huddle` in a terminal to see what's running.

**Continue in another thread.** After `/clear`, type `/huddle` again in the same window: it carries on with the same huddle. In any other thread, name the huddle: `/huddle 1` in Claude Code or `$huddle 1` in Codex. To leave a huddle and start afresh, ask for a new huddle.

## Commands

You rarely need these; the agents run most of them.

| Command | What it does |
|---|---|
| `huddle` | Show running huddles and how to connect |
| `huddle watch` | Follow the conversation live, and message both agents or one |
| `huddle say "…"` | Message both agents (`--to claude` or `--to codex` for one) |
| `huddle list` | Show running huddles |
| `huddle end [N]` | End a huddle |
| `huddle clean` | Delete ended huddles (`--all` deletes everything) |
| `huddle doctor` | Check your setup |
| `huddle update` | Install the latest release |
| `huddle uninstall` | Remove huddle and its skill (asks before deleting your history) |

## How it works

- **State** lives in one SQLite file, `~/.huddle/huddle.db`. There's no server, no port and no account.
- **Codex** is woken with `codex queue`, which adds the message to its thread as if you'd typed it, framed as a message from a colleague.
- **Claude Code** keeps a `huddle wait` running in the background, which ends when a message arrives and wakes it.
- **Identity** comes from each app's thread ID (`CLAUDE_CODE_SESSION_ID`, `CODEX_THREAD_ID`), so you never pass names or IDs.
- **The watch** reads each app's session files to show what the agents say to you and whether they're working.

Ended huddles are deleted automatically after 30 days. Nothing leaves your machine, and there's no telemetry. The history database does contain your conversations, so `huddle clean --all` deletes it whenever you like.

## Compatibility

huddle relies on parts of Claude Code and Codex that aren't documented APIs: `codex queue`, the thread ID variables, and the session file formats. An update to either app can break something. If that happens, `huddle doctor` is the first place to look, and please [open an issue](https://github.com/sourabhrathourr/huddle/issues).

Last tested with Claude Code 2.1.296 and Codex CLI 0.162.1. Windows isn't supported; use WSL.

## Development

```sh
git clone https://github.com/sourabhrathourr/huddle && cd huddle
ln -sf "$PWD/huddle" ~/.local/bin/huddle
ln -sfn "$PWD/skill" ~/.agents/skills/huddle
ln -sfn ~/.agents/skills/huddle ~/.claude/skills/huddle
python3 -m unittest discover -s tests
```

The command is a single file using only Python's standard library; please keep it that way. The skill (`skill/SKILL.md`) and the command change together: the skill quotes the command's output, and both carry the same version.

To release, bump `VERSION` in `huddle` and the marker at the end of `skill/SKILL.md`, add a `CHANGELOG.md` entry, and push a `vX.Y.Z` tag. CI builds the release that `install.sh` downloads.

## License

[MIT](LICENSE)
