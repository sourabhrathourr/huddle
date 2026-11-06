//! What the apps write to their own session files: what the user and each thread they opened say to each
//! other, whether the thread is working, and its title. Ported from `Direct`, `activity` and `thread_label`
//! in the huddle command; keep the two in step.

use crate::db::{Message, Step};
use std::sync::atomic::{AtomicI64, Ordering};
use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub struct Paths {
    pub huddle_db: PathBuf,
    pub claude: PathBuf,
    pub codex: PathBuf,
}

impl Paths {
    pub fn from_env() -> Paths {
        let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
        let var = |name: &str, default: PathBuf| std::env::var_os(name).map(PathBuf::from).unwrap_or(default);
        Paths {
            huddle_db: var("HUDDLE_HOME", home.join(".huddle")).join("huddle.db"),
            claude: var("CLAUDE_CONFIG_DIR", home.join(".claude")),
            codex: var("CODEX_HOME", home.join(".codex")),
        }
    }
}

/// Finding an agent's session file by its thread ID, remembered once found.
#[derive(Default)]
pub struct Transcripts {
    found: HashMap<String, PathBuf>,
}

impl Transcripts {
    pub fn find(&mut self, paths: &Paths, agent: &str, thread: &str) -> Option<PathBuf> {
        if let Some(p) = self.found.get(thread) {
            return Some(p.clone());
        }
        let hit = if agent == "codex" {
            let suffix = format!("-{thread}.jsonl");
            let mut hits = vec![];
            for year in dirs(&paths.codex.join("sessions")) {
                for month in dirs(&year) {
                    for day in dirs(&month) {
                        for f in entries(&day) {
                            let name = f.file_name().and_then(|n| n.to_str()).unwrap_or("");
                            if name.starts_with("rollout-") && name.ends_with(&suffix) {
                                hits.push(f);
                            }
                        }
                    }
                }
            }
            hits.sort();
            hits.pop()
        } else {
            let mut hits: Vec<PathBuf> = dirs(&paths.claude.join("projects"))
                .into_iter()
                .map(|d| d.join(format!("{thread}.jsonl")))
                .filter(|p| p.is_file())
                .collect();
            hits.sort();
            hits.pop()
        }?;
        self.found.insert(thread.to_string(), hit.clone());
        Some(hit)
    }
}

fn entries(dir: &Path) -> Vec<PathBuf> {
    fs::read_dir(dir).map(|it| it.filter_map(|e| e.ok().map(|e| e.path())).collect()).unwrap_or_default()
}

fn dirs(dir: &Path) -> Vec<PathBuf> {
    entries(dir).into_iter().filter(|p| p.is_dir()).collect()
}

fn json_line(raw: &[u8]) -> Option<serde_json::Map<String, Value>> {
    match serde_json::from_slice::<Value>(raw) {
        Ok(Value::Object(o)) => Some(o),
        _ => None,
    }
}

fn s<'a>(o: &'a serde_json::Map<String, Value>, key: &str) -> &'a str {
    o.get(key).and_then(Value::as_str).unwrap_or("")
}

fn obj<'a>(o: &'a serde_json::Map<String, Value>, key: &str) -> Option<&'a serde_json::Map<String, Value>> {
    o.get(key).and_then(Value::as_object)
}

pub fn stamp(o: &serde_json::Map<String, Value>) -> Option<f64> {
    let t = o.get("timestamp")?.as_str()?;
    chrono::DateTime::parse_from_rfc3339(t).ok().map(|d| d.timestamp_millis() as f64 / 1000.0)
}

/// A huddle message an agent quoted in its reply to the user ("> **Codex:** …"): already on screen.
fn relayed() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(r"(?m)^>\s*\*\*(?:User|Claude|Codex|[\w.-]+ \((?:Claude|Codex)\))\b[^\n]*\n?(?:>[^\n]*\n?)*").unwrap()
    })
}

/// The text blocks of a message's content, which is either a string or a list of blocks.
fn texts(content: Option<&Value>) -> Vec<String> {
    match content {
        Some(Value::String(t)) => vec![t.clone()],
        Some(Value::Array(blocks)) => blocks
            .iter()
            .filter_map(|b| b.as_object())
            .filter(|b| s(b, "type") == "text")
            .map(|b| s(b, "text").to_string())
            .collect(),
        _ => vec![],
    }
}

/// What the user and one thread they opened say to each other in that thread's own app.
pub struct Direct {
    agent: String,
    thread: String,
    name: String,
    since: f64,
    offset: u64,
    partial: Vec<u8>,
    turn: bool,
    reply: Option<String>,
    // its work, step by step, as helpers' runners record theirs
    steps: Vec<Step>,
    step_turn: Option<i64>,
    tools: HashMap<String, Step>,
    pending_say: Option<(f64, String)>,
}

/// A thread's turn starting: a message with no text that marks where its work goes in the conversation.
pub const ACTIVITY: &str = "·activity";
// Ids for turns and steps read from session files: above anything the history's own counters reach.
static NEXT: AtomicI64 = AtomicI64::new(1 << 40);

fn next_id() -> i64 {
    NEXT.fetch_add(1, Ordering::Relaxed)
}

/// A command as a step's title: without the shell wrapper, on one line, whole. The watch wraps it.
pub fn short_command(cmd: &str) -> String {
    static WRAP: OnceLock<Regex> = OnceLock::new();
    let re = WRAP.get_or_init(|| Regex::new(r"^\S*/(?:ba|z)?sh -l?c ").unwrap());
    let cmd = re.replace(cmd, "");
    let cmd = cmd.trim().trim_matches(|c| c == '\'' || c == '"');
    // keep its line breaks, so a script reads as one; the watch shows its first lines
    cmd.chars().take(4000).collect()
}

/// The end of a long output: what matters is usually last.
fn clip(text: &str) -> String {
    let lines: Vec<&str> = text.trim_end_matches('\n').split('\n').collect();
    if lines.len() > 400 {
        format!("… {} lines before this\n{}", lines.len() - 400, lines[lines.len() - 400..].join("\n"))
    } else {
        lines.join("\n")
    }
}

/// Claude Code's structured patch as a unified diff, so the watch can number its lines.
fn patch_text(path: &str, hunks: &[Value]) -> String {
    let mut out = vec![format!("--- {path}")];
    for h in hunks.iter().filter_map(Value::as_object) {
        let n = |k: &str| h.get(k).and_then(Value::as_i64).unwrap_or(0);
        out.push(format!("@@ -{},{} +{},{} @@", n("oldStart"), n("oldLines"), n("newStart"), n("newLines")));
        out.extend(h.get("lines").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).map(String::from));
    }
    out.join("\n")
}

fn diff_size(diff: &str) -> (usize, usize) {
    let added = diff.lines().filter(|l| l.starts_with('+') && !l.starts_with("+++")).count();
    let removed = diff.lines().filter(|l| l.starts_with('-') && !l.starts_with("---")).count();
    (added, removed)
}

fn file_name(path: &str) -> String {
    Path::new(path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string())
}

/// A Claude Code tool call as a step: (kind, title, detail). Edits carry their diff. Matches `claude_step` in huddle.
fn claude_step(name: &str, inp: &serde_json::Map<String, Value>) -> (String, String, Option<String>) {
    let path = ["file_path", "notebook_path", "path"].iter().map(|k| s(inp, k)).find(|p| !p.is_empty()).unwrap_or("");
    let lines = |t: &str, mark: char| t.split('\n').map(|x| format!("{mark}{x}")).collect::<Vec<_>>().join("\n");
    match name {
        "Bash" => {
            // with the few words the agent gave it, as Claude Code titles a command: "description\x1fcommand"
            let desc = s(inp, "description").split_whitespace().collect::<Vec<_>>().join(" ");
            let cmd = short_command(s(inp, "command"));
            ("run".into(), if desc.is_empty() { cmd } else { format!("{desc}\u{1f}{cmd}") }, None)
        }
        "Edit" | "MultiEdit" => {
            let edits: Vec<(String, String)> = match inp.get("edits").and_then(Value::as_array) {
                Some(list) => list.iter().filter_map(Value::as_object).map(|e| (s(e, "old_string").into(), s(e, "new_string").into())).collect(),
                None => vec![(s(inp, "old_string").into(), s(inp, "new_string").into())],
            };
            let diff = edits.iter().map(|(o, n)| format!("@@\n{}\n{}", lines(o, '-'), lines(n, '+'))).collect::<Vec<_>>().join("\n");
            let (a, r) = diff_size(&diff);
            ("edit".into(), format!("{}  +{a} −{r}", file_name(path)), Some(clip(&format!("--- {path}\n{diff}"))))
        }
        "Write" => {
            let body = s(inp, "content");
            ("edit".into(), format!("{}  (new, {} lines)", file_name(path), body.lines().count()), Some(clip(&format!("--- {path}\n{}", lines(body, '+')))))
        }
        "Read" => ("read".into(), if path.is_empty() { "a file".into() } else { path.into() }, None),
        "Grep" | "Glob" => ("search".into(), s(inp, "pattern").to_string(), None),
        "WebSearch" | "WebFetch" => ("search".into(), [s(inp, "query"), s(inp, "url")].into_iter().find(|x| !x.is_empty()).unwrap_or(name).to_string(), None),
        "Agent" | "Task" => ("tool".into(), format!("subagent: {}", s(inp, "description")), None),
        "TodoWrite" => {
            let plan = inp.get("todos").and_then(Value::as_array).map(|t| {
                t.iter().filter_map(Value::as_object).map(|x| {
                    let mark = match s(x, "status") { "completed" => "[x]", "in_progress" => "[~]", _ => "[ ]" };
                    format!("{mark} {}", s(x, "content"))
                }).collect::<Vec<_>>().join("\n")
            });
            ("plan".into(), "plan".into(), plan)
        }
        other => ("tool".into(), other.to_string(), Some(serde_json::to_string(inp).unwrap_or_default().chars().take(500).collect())),
    }
}

impl Direct {
    pub fn new(agent: &str, thread: &str, name: &str, since: f64) -> Direct {
        Direct {
            agent: agent.into(),
            thread: thread.into(),
            name: name.into(),
            since,
            offset: 0,
            partial: vec![],
            turn: false,
            reply: None,
            steps: vec![],
            step_turn: None,
            tools: HashMap::new(),
            pending_say: None,
        }
    }

    /// The steps read since last time.
    pub fn take_steps(&mut self) -> Vec<Step> {
        std::mem::take(&mut self.steps)
    }

    /// A new turn: the marker that puts its work in the conversation.
    fn begin(&mut self, ts: f64) -> Message {
        let id = next_id();
        self.step_turn = Some(id);
        self.pending_say = None;
        Message { id, sender: self.name.clone(), recipient: Some(ACTIVITY.into()), text: String::new(), sent_at: ts, reply_to: None, steer: false }
    }

    fn step(&mut self, ts: f64, kind: &str, title: String, detail: Option<String>, status: &str) -> Step {
        let st = Step {
            id: next_id(),
            member: self.name.clone(),
            turn: self.step_turn,
            kind: kind.into(),
            title,
            detail,
            status: Some(status.into()),
            at: ts,
            updated: ts,
        };
        self.steps.push(st.clone());
        st
    }

    /// What it said along the way, once something follows it (its last words are its reply, shown already).
    fn flush_say(&mut self) {
        if let Some((ts, text)) = self.pending_say.take() {
            self.step(ts, "say", "said".into(), Some(text), "ok");
        }
    }

    fn claude_steps(&mut self, o: &serde_json::Map<String, Value>, ts: f64) {
        let content = obj(o, "message").and_then(|m| m.get("content"));
        let Some(Value::Array(blocks)) = content else { return };
        for b in blocks.iter().filter_map(Value::as_object) {
            match (s(o, "type"), s(b, "type")) {
                ("assistant", "thinking") if !s(b, "thinking").trim().is_empty() => {
                    self.flush_say();
                    self.step(ts, "think", "thinking".into(), Some(s(b, "thinking").trim().to_string()), "ok");
                }
                ("assistant", "text") if !s(b, "text").trim().is_empty() => {
                    self.flush_say();
                    self.pending_say = Some((ts, s(b, "text").trim().to_string()));
                }
                ("assistant", "tool_use") => {
                    self.flush_say();
                    let empty = serde_json::Map::new();
                    let (kind, title, detail) = claude_step(s(b, "name"), obj(b, "input").unwrap_or(&empty));
                    let st = self.step(ts, &kind, title, detail, "running");
                    self.tools.insert(s(b, "id").to_string(), st);
                }
                ("user", "tool_result") => {
                    let result = obj(o, "toolUseResult");
                    if let Some(mut st) = self.tools.remove(s(b, "tool_use_id")) {
                        let failed = b.get("is_error").and_then(Value::as_bool).unwrap_or(false);
                        let text = match b.get("content") {
                            Some(Value::String(t)) => t.clone(),
                            other => texts(other).join("\n"),
                        };
                        st.status = Some(if failed { "failed" } else { "ok" }.into());
                        if failed || matches!(st.kind.as_str(), "run" | "tool" | "search") {
                            st.detail = Some(clip(&text));
                        }
                        if let Some(r) = result {
                            match (st.kind.as_str(), r.get("structuredPatch").and_then(Value::as_array), obj(r, "file")) {
                                ("edit", Some(hunks), _) if !hunks.is_empty() => st.detail = Some(clip(&patch_text(s(r, "filePath"), hunks))),
                                ("read", _, Some(file)) => {
                                    if let Some(n) = file.get("numLines").and_then(Value::as_i64) {
                                        st.detail = Some(format!("Read {n} lines"));
                                    }
                                }
                                _ => {}
                            }
                        }
                        st.updated = ts;
                        self.steps.push(st);
                    }
                }
                _ => {}
            }
        }
    }

    fn codex_steps(&mut self, item: &serde_json::Map<String, Value>, ts: f64) {
        match s(item, "type") {
            "AgentMessage" if s(item, "phase") == "commentary" => {
                let text = item.get("content").and_then(Value::as_array).map(|c| {
                    c.iter().filter_map(|x| x.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join("")
                });
                if let Some(t) = text.filter(|t| !t.trim().is_empty()) {
                    self.step(ts, "say", "said".into(), Some(t.trim().to_string()), "ok");
                }
            }
            "Reasoning" => {
                let text = item.get("summary_text").and_then(Value::as_array).map(|c| {
                    c.iter().filter_map(Value::as_str).collect::<Vec<_>>().join("\n\n")
                });
                if let Some(t) = text.filter(|t| !t.trim().is_empty()) {
                    self.step(ts, "think", "thinking".into(), Some(t), "ok");
                }
            }
            "CommandExecution" => {
                let parts: Vec<&str> = item.get("command").and_then(Value::as_array).map(|c| c.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
                let cmd = if parts.len() == 3 && parts[1] == "-lc" { parts[2].to_string() } else { parts.join(" ") };
                let code = item.get("exit_code").and_then(Value::as_i64);
                let ok = s(item, "status") == "completed" && code.unwrap_or(0) == 0;
                let mut title = short_command(&cmd);
                if let (false, Some(c)) = (ok, code) {
                    title += &format!("  (exit {c})");
                }
                self.step(ts, "run", title, Some(clip(s(item, "aggregated_output"))), if ok { "ok" } else { "failed" });
            }
            "FileChange" => {
                let changes = obj(item, "changes");
                let mut diff = String::new();
                let mut names = vec![];
                for (path, change) in changes.into_iter().flatten() {
                    names.push(file_name(path));
                    let d = change.get("unified_diff").and_then(Value::as_str).unwrap_or("");
                    diff += &format!("--- {path}\n{d}\n");
                }
                let (a, r) = diff_size(&diff);
                let ok = s(item, "status") == "completed";
                self.step(ts, "edit", format!("{}  +{a} −{r}", names.join(", ")), Some(clip(&diff)), if ok { "ok" } else { "failed" });
            }
            _ => {}
        }
    }

    pub fn read(&mut self, paths: &Paths, transcripts: &mut Transcripts) -> Vec<Message> {
        let Some(path) = transcripts.find(paths, &self.agent, &self.thread) else { return vec![] };
        let Ok(mut f) = File::open(&path) else { return vec![] };
        if f.seek(SeekFrom::Start(self.offset)).is_err() {
            return vec![];
        }
        let mut data = vec![];
        if f.read_to_end(&mut data).is_err() {
            return vec![];
        }
        self.offset += data.len() as u64;
        let mut all = std::mem::take(&mut self.partial);
        all.extend_from_slice(&data);
        let mut lines: Vec<&[u8]> = all.split(|b| *b == b'\n').collect();
        let rest = lines.pop().unwrap_or(&[]).to_vec();
        let mut out = vec![];
        for raw in lines {
            let Some(o) = json_line(raw) else { continue };
            let Some(ts) = stamp(&o) else { continue };
            if ts < self.since {
                continue;
            }
            if self.agent == "claude" {
                let before = self.turn_started(&o);
                out.extend(self.claude(&o, ts));
                if before {
                    out.push(self.begin(ts));
                } else if s(&o, "type") == "system" && matches!(s(&o, "subtype"), "turn_duration" | "stop_hook_summary") {
                    self.pending_say = None; // its last words were its reply
                }
                self.claude_steps(&o, ts);
            } else {
                out.extend(self.codex(&o, ts));
                let empty = serde_json::Map::new();
                let p = obj(&o, "payload").unwrap_or(&empty);
                if s(&o, "type") == "event_msg" && s(p, "type") == "task_started" {
                    out.push(self.begin(ts));
                }
                if s(&o, "type") == "event_msg" && s(p, "type") == "item_completed" {
                    if let Some(item) = obj(p, "item") {
                        self.codex_steps(item, ts);
                    }
                }
            }
        }
        self.partial = rest;
        out
    }

    /// Whether this Claude Code line starts a turn: a message to it that isn't a tool's result.
    fn turn_started(&self, o: &serde_json::Map<String, Value>) -> bool {
        if s(o, "type") != "user" || o.get("isMeta").and_then(Value::as_bool).unwrap_or(false) {
            return false;
        }
        let content = obj(o, "message").and_then(|m| m.get("content"));
        if let Some(Value::Array(blocks)) = content {
            if blocks.iter().any(|b| b.get("type").and_then(Value::as_str) == Some("tool_result")) {
                return false;
            }
        }
        !texts(content).iter().any(|t| t.starts_with("[Request interrupted"))
    }

    fn said(&self, sender: &str, recipient: &str, text: &str, ts: f64) -> Vec<Message> {
        let text = if recipient == "you" { relayed().replace_all(text, "").into_owned() } else { text.to_string() };
        if text.trim().is_empty() {
            return vec![];
        }
        vec![Message { id: 0, sender: sender.into(), recipient: Some(recipient.into()), text, sent_at: ts, reply_to: None, steer: false }]
    }

    fn claude(&mut self, o: &serde_json::Map<String, Value>, ts: f64) -> Vec<Message> {
        let kind = s(o, "type");
        if kind == "system" && matches!(s(o, "subtype"), "turn_duration" | "stop_hook_summary") {
            self.turn = false;
            return match self.reply.take() {
                Some(reply) => self.said(&self.name, "you", &reply, ts),
                None => vec![],
            };
        }
        let content = obj(o, "message").and_then(|m| m.get("content"));
        // what the user typed while the thread was mid-turn: Claude Code keeps it as an attachment, not a user turn
        if kind == "attachment" {
            if let Some(a) = obj(o, "attachment").filter(|a| s(a, "type") == "queued_command") {
                let human = obj(a, "origin").map(|x| s(x, "kind") == "human").unwrap_or(false);
                // plain text, or a list of parts when it came with a picture
                let text = texts(a.get("prompt")).join("\n").trim().to_string();
                return if human && !text.is_empty() { self.said("you", &self.name, &text, ts) } else { vec![] };
            }
            return vec![];
        }
        if kind == "user" && !o.get("isMeta").and_then(Value::as_bool).unwrap_or(false) {
            if let Some(Value::Array(blocks)) = content {
                if blocks.iter().any(|b| b.get("type").and_then(Value::as_str) == Some("tool_result")) {
                    return vec![];
                }
            }
            let mut text = texts(content)
                .into_iter()
                .filter(|t| !t.starts_with("<system-reminder>") && !t.starts_with("[Request interrupted"))
                .collect::<Vec<_>>()
                .join("\n");
            static COMMAND: OnceLock<(Regex, Regex)> = OnceLock::new();
            let (name_re, args_re) = COMMAND.get_or_init(|| {
                (Regex::new(r"<command-name>(.*?)</command-name>").unwrap(), Regex::new(r"(?s)<command-args>(.*?)</command-args>").unwrap())
            });
            if let Some(c) = name_re.captures(&text) {
                let args = args_re.captures(&text).map(|a| a[1].trim().to_string()).unwrap_or_default();
                text = if args.is_empty() { c[1].to_string() } else { format!("{} {}", &c[1], args) };
            }
            self.turn = true;
            self.reply = None;
            let human = obj(o, "origin").map(|x| s(x, "kind") == "human").unwrap_or(false);
            return if human { self.said("you", &self.name, &text, ts) } else { vec![] };
        }
        if kind == "assistant" && self.turn {
            let text = match content {
                Some(Value::Array(blocks)) => blocks
                    .iter()
                    .filter_map(|b| b.as_object())
                    .filter(|b| s(b, "type") == "text")
                    .map(|b| s(b, "text"))
                    .collect::<Vec<_>>()
                    .join("\n"),
                _ => String::new(),
            };
            if !text.trim().is_empty() {
                self.reply = Some(text);
            }
        }
        vec![]
    }

    fn codex(&mut self, o: &serde_json::Map<String, Value>, ts: f64) -> Vec<Message> {
        let empty = serde_json::Map::new();
        let p = obj(o, "payload").unwrap_or(&empty);
        if s(o, "type") == "event_msg" && s(p, "type") == "task_started" {
            self.turn = obj(p, "turn_attribution").map(|a| s(a, "turn_trigger") == "user").unwrap_or(false);
        }
        if s(o, "type") != "response_item" || s(p, "type") != "message" {
            return vec![];
        }
        let text = p
            .get("content")
            .and_then(Value::as_array)
            .map(|c| c.iter().filter_map(|x| x.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join("\n"))
            .unwrap_or_default();
        let kinds: Vec<&str> = obj(p, "internal_chat_message_metadata_passthrough")
            .and_then(|m| m.get("content_item_kinds"))
            .and_then(Value::as_array)
            .map(|k| k.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default();
        if s(p, "role") == "user" && kinds.contains(&"user.text") && self.turn {
            return self.said("you", &self.name, &text, ts);
        }
        if s(p, "role") == "assistant" && s(p, "phase") == "final_answer" {
            return self.said(&self.name, "you", &text, ts);
        }
        vec![]
    }
}

/// Where a transcript line falls in a turn.
fn turn_event(agent: &str, o: &serde_json::Map<String, Value>) -> Option<&'static str> {
    let kind = s(o, "type");
    if agent == "codex" {
        let p_type = obj(o, "payload").map(|p| s(p, "type")).unwrap_or("");
        return match kind {
            "event_msg" => match p_type {
                "task_complete" | "turn_aborted" => Some("end"),
                "task_started" => Some("start"),
                _ => None,
            },
            "response_item" if matches!(p_type, "message" | "function_call" | "custom_tool_call") => Some("step"),
            _ => None,
        };
    }
    if (kind == "system" && matches!(s(o, "subtype"), "turn_duration" | "stop_hook_summary"))
        || o.get("isCompactSummary").and_then(Value::as_bool).unwrap_or(false)
    {
        return Some("end");
    }
    if kind != "user" && kind != "assistant" {
        return None;
    }
    let content = obj(o, "message").and_then(|m| m.get("content"));
    if kind == "user" && texts(content).iter().any(|t| t.starts_with("[Request interrupted")) {
        return Some("end");
    }
    Some("step")
}

fn tail(path: &Path, size: u64) -> Option<Vec<u8>> {
    let mut f = File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    f.seek(SeekFrom::Start(len.saturating_sub(size))).ok()?;
    let mut data = vec![];
    f.read_to_end(&mut data).ok()?;
    Some(data)
}

/// When the thread's current turn started, or None when it's idle. Best effort, from its transcript's tail.
pub fn activity(paths: &Paths, transcripts: &mut Transcripts, agent: &str, thread: &str) -> Option<f64> {
    let path = transcripts.find(paths, agent, thread)?;
    let modified = fs::metadata(&path).ok()?.modified().ok()?;
    if modified.elapsed().map(|e| e.as_secs() > 1800).unwrap_or(true) {
        return None;
    }
    let data = tail(&path, 2 * 1024 * 1024)?;
    let mut since = None;
    for raw in data.split(|b| *b == b'\n').rev() {
        let Some(o) = json_line(raw) else { continue };
        match turn_event(agent, &o) {
            Some("end") => break,
            Some(kind) => {
                since = stamp(&o).or(since);
                if kind == "start" {
                    break;
                }
            }
            None => {}
        }
    }
    since
}

/// The thread as the user knows it: its title in the app, else the first thing the user typed there.
pub fn thread_label(paths: &Paths, transcripts: &mut Transcripts, agent: &str, thread: &str) -> Option<String> {
    let path = transcripts.find(paths, agent, thread)?;
    let mut titles: Vec<String> = vec![];
    if let Some(data) = tail(&path, 1_000_000) {
        for raw in data.split(|b| *b == b'\n') {
            if let Some(o) = json_line(raw) {
                if matches!(s(&o, "type"), "custom-title" | "ai-title") {
                    let t = if !s(&o, "customTitle").is_empty() { s(&o, "customTitle") } else { s(&o, "aiTitle") };
                    titles.push(t.to_string());
                }
            }
        }
    }
    let mut prompt = None;
    if let Ok(mut f) = File::open(&path) {
        let mut head = vec![];
        let _ = (&mut f).take(4_000_000).read_to_end(&mut head);
        for raw in head.split(|b| *b == b'\n').take(3000) {
            let Some(o) = json_line(raw) else { continue };
            let found = if agent == "claude" {
                let human = obj(&o, "origin").map(|x| s(x, "kind") == "human").unwrap_or(false);
                (s(&o, "type") == "user" && human).then(|| texts(obj(&o, "message").and_then(|m| m.get("content"))))
            } else {
                obj(&o, "payload").and_then(|p| {
                    let kinds = obj(p, "internal_chat_message_metadata_passthrough")
                        .and_then(|m| m.get("content_item_kinds"))
                        .and_then(Value::as_array)
                        .map(|k| k.iter().any(|x| x.as_str() == Some("user.text")))
                        .unwrap_or(false);
                    (s(p, "role") == "user" && kinds).then(|| {
                        p.get("content")
                            .and_then(Value::as_array)
                            .map(|c| c.iter().filter_map(|x| x.get("text").and_then(Value::as_str).map(String::from)).collect())
                            .unwrap_or_default()
                    })
                })
            };
            if let Some(t) = found {
                prompt = Some(t.join(" "));
                break;
            }
        }
    }
    if agent == "codex" {
        if let Ok(index) = fs::read(paths.codex.join("session_index.jsonl")) {
            let named: Vec<String> = index
                .split(|b| *b == b'\n')
                .filter_map(json_line)
                .filter(|o| s(o, "id") == thread)
                .map(|o| s(&o, "thread_name").to_string())
                .collect();
            if !named.is_empty() {
                titles = named;
            }
        }
    }
    let raw = titles.last().filter(|t| !t.is_empty()).cloned().or(prompt).unwrap_or_default();
    let text = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() || text.starts_with('<') || text.starts_with("/huddle") || text.starts_with("$huddle") {
        return None;
    }
    Some(if text.chars().count() <= 50 { text } else { text.chars().take(49).collect::<String>().trim_end().to_string() + "…" })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_the_user_typed_mid_turn_is_a_message() {
        let line = r#"{"type":"attachment","attachment":{"type":"queued_command","prompt":"also check the README","origin":{"kind":"human"},"humanTurn":true},"timestamp":"2026-11-06T05:47:22.472Z"}"#;
        let o: serde_json::Map<String, Value> = serde_json::from_str(line).unwrap();
        let mut d = Direct::new("claude", "t", "claude", 0.0);
        let said = d.claude(&o, stamp(&o).unwrap());
        assert_eq!(said.len(), 1);
        assert_eq!((said[0].sender.as_str(), said[0].text.as_str()), ("you", "also check the README"));
    }

    #[test]
    fn with_a_picture_its_words_are_the_message() {
        let line = r#"{"type":"attachment","attachment":{"type":"queued_command","prompt":[{"type":"text","text":"[Image #28] order messed up?"},{"type":"image","source":{"type":"base64","data":"iVBOR"}}],"origin":{"kind":"human"}},"timestamp":"2026-11-06T05:49:38.175Z"}"#;
        let o: serde_json::Map<String, Value> = serde_json::from_str(line).unwrap();
        let mut d = Direct::new("claude", "t", "claude", 0.0);
        let said = d.claude(&o, stamp(&o).unwrap());
        assert_eq!(said[0].text, "[Image #28] order messed up?");
    }
}
