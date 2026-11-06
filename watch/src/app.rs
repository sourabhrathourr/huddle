//! The watch's state: every running huddle as a feed, which one is on screen, what's typed, and the keys.

use crate::db::{self, Huddle, Member, Message, Step};
use crate::loader::Update;
use ratatui::crossterm::event::{Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use ratatui::text::Line;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::process::{Command, Stdio};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::time::Instant;

pub const AGENTS: [&str; 2] = ["claude", "codex"];

pub fn app_name(agent: &str) -> &str {
    match agent {
        "claude" => "Claude",
        "codex" => "Codex",
        other => other,
    }
}

pub fn member_label(m: &Member) -> String {
    if m.name == m.agent {
        app_name(&m.agent).to_string()
    } else {
        format!("{} ({})", m.name, app_name(&m.agent))
    }
}

/// A huddle's members by name. Includes members who left, so their old messages still show who sent them.
#[derive(Default, Clone)]
pub struct Crew {
    pub all: Vec<Member>,
}

impl Crew {
    pub fn active(&self) -> impl Iterator<Item = &Member> {
        self.all.iter().filter(|m| m.left_at.is_none())
    }

    pub fn names(&self) -> Vec<String> {
        self.active().map(|m| m.name.clone()).collect()
    }

    pub fn by_name(&self, name: &str) -> Option<&Member> {
        self.all.iter().rev().find(|m| m.name == name)
    }

    pub fn agent(&self, name: &str) -> String {
        self.by_name(name).map(|m| m.agent.clone()).unwrap_or_else(|| name.to_string())
    }

    pub fn label(&self, name: &str) -> String {
        if name == "you" {
            return "You".into();
        }
        self.by_name(name).map(member_label).unwrap_or_else(|| app_name(name).to_string())
    }
}

/// One running huddle as the watch shows it. The loader thread fills it; drawing only reads it.
pub struct Feed {
    pub h: Huddle,
    pub crew: Crew,
    pub items: Vec<Message>,
    /// Every step its helpers took, by id: in the order they happened.
    pub steps: BTreeMap<i64, Step>,
    /// Each message drawn at `drawn_width`, in order.
    pub cache: Vec<Vec<Line<'static>>>,
    pub drawn_width: usize,
    /// How many lines the conversation was when last drawn: scrolled up, new ones mustn't move what you're reading.
    pub drawn_total: usize,
    pub scroll: usize,
    pub unseen: usize,
    pub to: Option<String>,
    pub acts: HashMap<String, Option<f64>>,
    pub ended: bool,
    pub name: String,
    pub titles: HashMap<String, String>,
    pub listening: HashSet<String>,
    pub reads: HashMap<String, i64>,
    /// Each finished step as drawn, by (step, live view or not): drawing an old diff again every frame is slow.
    pub traced: crate::ui::Traced,
}

/// `Feed::to` set to this means everyone, chosen on purpose.
pub const EVERYONE: &str = "*";

impl Feed {
    fn new(h: Huddle) -> Feed {
        let name = format!("Huddle {}", h.code);
        Feed {
            h,
            crew: Crew::default(),
            items: vec![],
            steps: BTreeMap::new(),
            cache: vec![],
            drawn_width: 0,
            drawn_total: 0,
            scroll: 0,
            unseen: 0,
            to: None,
            acts: HashMap::new(),
            ended: false,
            name,
            titles: HashMap::new(),
            listening: HashSet::new(),
            reads: HashMap::new(),
            traced: HashMap::new(),
        }
    }

    /// When anything last happened here: the latest message, or when it opened.
    pub fn last_at(&self) -> f64 {
        self.items.last().map(|m| m.sent_at).unwrap_or(self.h.opened_at).max(self.h.opened_at)
    }

    /// Who a message goes to unless the user picks: the main agent when helpers are around (a helper acts on
    /// whatever reaches it, so it's never messaged by accident), else everyone.
    fn default_to(&self) -> Option<String> {
        if self.crew.active().any(|m| m.helper) {
            self.crew.active().find(|m| !m.helper).map(|m| m.name.clone())
        } else {
            None
        }
    }

    /// Who a message goes to now: a member's name, or None for everyone.
    pub fn target(&self) -> Option<String> {
        match &self.to {
            Some(t) if t == EVERYONE => None,
            Some(t) if self.crew.names().contains(t) => Some(t.clone()),
            _ => self.default_to(),
        }
    }

    /// What Tab steps through: threads the user opened first, then helpers, then everyone.
    pub fn choices(&self) -> Vec<Option<String>> {
        let mut out: Vec<Option<String>> = self.crew.active().filter(|m| !m.helper).map(|m| Some(m.name.clone())).collect();
        out.extend(self.crew.active().filter(|m| m.helper).map(|m| Some(m.name.clone())));
        out.push(None);
        out
    }

    /// Whether a message the user sent to one member has reached it: read by its wait or queued into its app, or for
    /// a helper, being worked on, steered into its turn, or answered.
    pub fn seen(&self, m: &Message) -> bool {
        let Some(to) = m.recipient.as_deref() else { return true };
        if m.sender != "you" || m.id <= 0 || to == "you" {
            return true;
        }
        self.reads.get(to).map(|r| *r >= m.id).unwrap_or(false)
            || self.items.iter().any(|x| x.reply_to == Some(m.id))
            || self.steps.values().any(|s| s.member == to && (s.turn == Some(m.id) || (s.title == "steered by you" && s.detail.as_deref() == Some(m.text.as_str()))))
    }

    /// Whether what's sent to this member reaches it now. Helpers and Codex threads are woken; a Claude Code thread
    /// hears only while it has a `huddle wait` running.
    pub fn hears(&self, m: &Member) -> bool {
        m.helper || m.agent != "claude" || self.listening.contains(&m.name)
    }

    /// What a member is doing: "working 1:02 · running pytest", "idle", "asleep"…
    pub fn state(&self, m: &Member) -> String {
        if self.ended {
            return "done".into(); // nobody works in a huddle that ended, whatever it last showed
        }
        let clock = |since: f64| {
            let secs = (db::now() - since).max(0.0) as u64;
            format!("working {}:{:02}", secs / 60, secs % 60)
        };
        if m.helper {
            return match m.state.as_deref().unwrap_or("starting") {
                "working" => {
                    clock(m.since.unwrap_or_else(db::now)) + &m.activity.as_ref().map(|a| format!(" · {a}")).unwrap_or_default()
                }
                "failed" => m.activity.as_ref().map(|a| format!("failed: {a}")).unwrap_or_else(|| "failed".into()),
                // the user has its session open in its own app (`huddle show`)
                "open" => m.activity.clone().unwrap_or_else(|| "open in its app".into()),
                other => other.to_string(),
            };
        }
        match m.thread.as_ref().and_then(|t| self.acts.get(t).copied().flatten()) {
            Some(since) => clock(since),
            None => "idle".into(),
        }
    }
}

pub fn busy(state: &str) -> bool {
    state.starts_with("working") || state == "starting"
}

pub struct App {
    updates: Receiver<Vec<Update>>,
    code: Option<String>,
    /// The repo the watch started in: huddles elsewhere say where they are.
    pub here: String,
    pub feeds: Vec<Feed>,
    pub current: Option<i64>,
    pub picking: bool,
    pub choice: usize,
    pub typed: String,
    pub notice: Option<(String, Instant, u64)>,
    pub born: Instant,
    /// The member whose every step fills the screen (Ctrl-O), and how far up that view is scrolled.
    pub zoom: Option<String>,
    pub zoom_scroll: usize,
    /// The agent list (Ctrl-O) is open, and which row is chosen.
    pub agents: bool,
    /// The list of every key (?) is open.
    pub help: bool,
    pub agent_choice: usize,
    /// A session to open in its own app, by (huddle code, member name): the run loop hands it the terminal.
    pub open: Option<(String, String)>,
    started: bool,
    pub page: usize,
    results: (Sender<String>, Receiver<String>),
}

impl App {
    pub fn new(updates: Receiver<Vec<Update>>, code: Option<String>) -> App {
        App {
            updates,
            code,
            here: repo_root(),
            feeds: vec![],
            current: None,
            picking: false,
            choice: 0,
            typed: String::new(),
            notice: None,
            born: Instant::now(),
            zoom: None,
            zoom_scroll: 0,
            agents: false,
            help: false,
            agent_choice: 0,
            open: None,
            started: false,
            page: 10,
            results: channel(),
        }
    }

    pub fn feed(&self) -> Option<&Feed> {
        self.feeds.iter().find(|f| Some(f.h.id) == self.current)
    }

    pub fn feed_mut(&mut self) -> Option<&mut Feed> {
        let current = self.current;
        self.feeds.iter_mut().find(|f| Some(f.h.id) == current)
    }

    /// The current huddle's members as a tree: each thread the user opened, then the helpers it started under it.
    pub fn agent_rows(&self) -> Vec<(Member, usize)> {
        let Some(f) = self.feed() else { return vec![] };
        let all: Vec<Member> = f.crew.active().cloned().collect();
        let ids: HashSet<i64> = all.iter().map(|m| m.id).collect();
        fn walk(m: &Member, depth: usize, all: &[Member], out: &mut Vec<(Member, usize)>) {
            out.push((m.clone(), depth));
            for kid in all.iter().filter(|k| k.parent == Some(m.id)) {
                walk(kid, depth + 1, all, out);
            }
        }
        let mut out = vec![];
        for root in all.iter().filter(|m| m.parent.map(|p| !ids.contains(&p)).unwrap_or(true)) {
            walk(root, 0, &all, &mut out);
        }
        out
    }

    fn agents_key(&mut self, key: KeyEvent) -> bool {
        let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
        let rows = self.agent_rows();
        match key.code {
            KeyCode::Char('c') if ctrl => return false,
            KeyCode::Esc | KeyCode::Char('o') if key.code == KeyCode::Esc || ctrl => self.agents = false,
            KeyCode::Up | KeyCode::Char('k') | KeyCode::BackTab => self.agent_choice = self.agent_choice.saturating_sub(1),
            KeyCode::Down | KeyCode::Char('j') | KeyCode::Tab => {
                self.agent_choice = (self.agent_choice + 1).min(rows.len().saturating_sub(1))
            }
            KeyCode::Enter => {
                let Some((m, _)) = rows.get(self.agent_choice).cloned() else { return true };
                let Some(f) = self.feed() else { return true };
                let (code, working) = (f.h.code.clone(), busy(&f.state(&m)));
                self.agents = false;
                if !m.helper || !working || m.shared {
                    // the real session: a thread you opened, in its own window; a helper, in its app. Where
                    // there's no way there, `huddle show` says so and it's followed here instead.
                    self.open = Some((code, m.name.clone()));
                } else {
                    // a working helper whose session wouldn't update meanwhile: follow it here
                    self.follow(&m.name);
                    self.say(format!("{} is working, so this is its live view. Once it's done, ctrl+o and Enter open its session.", member_label(&m)));
                }
            }
            _ => {}
        }
        true
    }

    /// The number of the huddle on screen, if any: where a restarted watch opens.
    pub fn current_code(&self) -> Option<String> {
        self.feed().map(|f| f.h.code.clone())
    }

    /// Follow one agent's every step here (the live view).
    pub fn follow(&mut self, name: &str) {
        self.zoom = Some(name.to_string());
        self.zoom_scroll = 0;
    }

    pub fn say(&mut self, text: impl Into<String>) {
        self.notice = Some((text.into(), Instant::now(), 6));
    }

    /// Take in whatever the loader has sent since last time. Never waits.
    pub fn refresh(&mut self) {
        let mut got = false;
        let mut newcomer: Option<(i64, String)> = None;
        // the list reorders as huddles get news; keep the highlight on the same huddle
        let mut highlighted = self.picker_order().get(self.choice).map(|i| self.feeds[*i].h.id);
        while let Ok(batch) = self.updates.try_recv() {
            got = true;
            for u in batch {
                let fresh = !self.feeds.iter().any(|f| f.h.id == u.h.id);
                if fresh {
                    self.feeds.push(Feed::new(u.h.clone()));
                }
                let f = self.feeds.iter_mut().find(|f| f.h.id == u.h.id).expect("just added");
                if f.scroll > 0 {
                    f.unseen += u.items.len();
                }
                f.h = u.h;
                f.crew = u.crew;
                // in time order across reads too: a session record can arrive after newer messages
                let newest = f.items.last().map(|m| m.sent_at).unwrap_or(f64::MIN);
                let late = u.items.iter().any(|m| m.sent_at < newest);
                f.items.extend(u.items);
                if late {
                    f.items.sort_by(|a, b| a.sent_at.partial_cmp(&b.sent_at).unwrap_or(std::cmp::Ordering::Equal));
                    f.cache.clear(); // drawn again in the new order
                }
                for step in u.steps {
                    if step.kind == "dropped" {
                        f.steps.remove(&step.id); // its words turned out to be the answer, shown as a message
                        f.traced.retain(|(id, _), _| *id != step.id);
                    } else {
                        f.steps.insert(step.id, step);
                    }
                }
                f.ended = u.ended;
                if let Some(acts) = u.acts {
                    f.acts = acts;
                }
                if let Some(name) = u.name {
                    f.name = name;
                }
                if let Some(titles) = u.titles {
                    f.titles = titles;
                }
                f.reads = u.reads.into_iter().collect();
                if let Some(listening) = u.listening {
                    f.listening = listening.into_iter().collect();
                }
                if fresh && self.started && !f.ended {
                    newcomer = Some((f.h.id, f.name.clone()));
                }
            }
            if !self.started {
                self.start();
            }
        }
        if let Some((id, name)) = newcomer {
            // A new huddle: ask whether to watch it, unless the user is in the middle of something here.
            let busy = !self.typed.is_empty() || self.zoom.is_some() || self.agents || self.help;
            if busy {
                self.say(format!("New huddle: {name} · esc to see all huddles"));
            } else {
                self.picking = true;
                highlighted = Some(id);
                self.say("A new huddle started. Enter to watch it, esc to stay where you were");
            }
        }
        if got {
            let current = self.current;
            self.feeds.retain(|f| !f.ended || Some(f.h.id) == current);
            if self.current.is_some() && self.feed().is_none() {
                self.current = None;
            }
            if self.current.is_none() && !self.picking {
                self.current = self.feeds.last().map(|f| f.h.id);
            }
            if let Some(id) = highlighted {
                if let Some(at) = self.picker_order().iter().position(|i| self.feeds[*i].h.id == id) {
                    self.choice = at;
                }
            }
        }
        while let Ok(problem) = self.results.1.try_recv() {
            self.notice = Some((problem, Instant::now(), 10));
        }
        if self.notice.as_ref().map(|(_, at, secs)| at.elapsed().as_secs() >= *secs).unwrap_or(false) {
            self.notice = None;
        }
    }

    /// The first time huddles are known: open the one asked for or the only one; with several, ask which.
    fn start(&mut self) {
        self.started = true;
        let chosen = match &self.code {
            Some(code) => self.feeds.iter().rev().find(|f| &f.h.code == code).map(|f| f.h.id),
            None if self.feeds.len() == 1 => Some(self.feeds[0].h.id),
            None => None,
        };
        match chosen {
            Some(id) => self.current = Some(id),
            None if !self.feeds.is_empty() => {
                self.picking = true;
                self.choice = 0; // the list starts with the latest
            }
            None => {}
        }
    }

    /// The huddles in the order the list shows them: the one where something happened last comes first.
    pub fn picker_order(&self) -> Vec<usize> {
        let mut order: Vec<usize> = (0..self.feeds.len()).collect();
        order.sort_by(|a, b| self.feeds[*b].last_at().partial_cmp(&self.feeds[*a].last_at()).unwrap_or(std::cmp::Ordering::Equal));
        order
    }

    fn open_choice(&mut self, at: usize) {
        if let Some(&i) = self.picker_order().get(at) {
            self.current = Some(self.feeds[i].h.id);
            self.picking = false;
            self.zoom = None;
        }
    }

    /// React to one terminal event. Returns false to quit.
    pub fn handle(&mut self, event: Event) -> bool {
        match event {
            Event::Paste(text) => {
                if !self.picking {
                    self.typed.push_str(&text.replace("\r\n", "\n").replace('\r', "\n"));
                }
                true
            }
            Event::Key(key) if key.kind != KeyEventKind::Release => {
                if self.help {
                    // any key closes the list of keys; Ctrl-C still quits
                    if key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL) {
                        return false;
                    }
                    self.help = false;
                    true
                } else if self.agents && self.feed().is_some() {
                    self.agents_key(key)
                } else if self.picking || self.feed().is_none() {
                    self.picker_key(key)
                } else {
                    self.chat_key(key)
                }
            }
            _ => true,
        }
    }

    fn picker_key(&mut self, key: KeyEvent) -> bool {
        let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
        match key.code {
            KeyCode::Char('c') | KeyCode::Char('d') | KeyCode::Char('q') if ctrl => return false,
            KeyCode::Char('q') if self.feed().is_none() => return false,
            KeyCode::Up | KeyCode::Char('k') | KeyCode::BackTab => self.choice = self.choice.saturating_sub(1),
            KeyCode::Down | KeyCode::Char('j') | KeyCode::Tab => {
                self.choice = (self.choice + 1).min(self.feeds.len().saturating_sub(1))
            }
            KeyCode::Enter => self.open_choice(self.choice),
            KeyCode::Char(c) if c.is_ascii_digit() && !ctrl => {
                // a huddle's number opens it
                let code = c.to_string();
                if let Some(at) = self.picker_order().iter().position(|i| self.feeds[*i].h.code == code) {
                    self.choice = at;
                    self.open_choice(at);
                }
            }
            KeyCode::Esc if self.feed().is_some() => self.picking = false,
            _ => {}
        }
        true
    }

    fn chat_key(&mut self, key: KeyEvent) -> bool {
        let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
        let page = self.page;
        match key.code {
            KeyCode::Char('c') if ctrl => return false,
            KeyCode::Char('d') if ctrl => {
                if self.typed.is_empty() {
                    return false;
                }
                self.typed.clear();
            }
            KeyCode::Char('o') | KeyCode::Char('0') if ctrl => {
                // the agent list, on the one being followed if any (Ctrl+0 too: in many fonts O and 0 look alike)
                let rows = self.agent_rows();
                self.agent_choice = self.zoom.as_ref().and_then(|z| rows.iter().position(|(m, _)| &m.name == z)).unwrap_or(0);
                self.agents = true;
            }
            KeyCode::Char('n') | KeyCode::Char('p') if ctrl => {
                self.zoom = None;
                let ids: Vec<i64> = self.feeds.iter().map(|f| f.h.id).collect();
                if let Some(i) = ids.iter().position(|id| Some(*id) == self.current) {
                    let step = if key.code == KeyCode::Char('n') { 1 } else { ids.len() - 1 };
                    self.current = Some(ids[(i + step) % ids.len()]);
                }
            }
            KeyCode::Char('u') if ctrl => self.typed.clear(),
            KeyCode::Char('w') if ctrl => {
                let trimmed = self.typed.trim_end().to_string();
                let cut = trimmed.char_indices().rev().find(|(_, c)| c.is_whitespace()).map(|(i, c)| i + c.len_utf8()).unwrap_or(0);
                self.typed.truncate(cut);
            }
            KeyCode::Char('j') if ctrl => self.typed.push('\n'),
            KeyCode::Esc if self.zoom.is_some() => self.zoom = None,
            KeyCode::Esc => {
                self.picking = true;
                let order = self.picker_order();
                self.choice = order.iter().position(|i| Some(self.feeds[*i].h.id) == self.current).unwrap_or(0);
            }
            KeyCode::Enter if ctrl => self.submit(true),
            KeyCode::Enter if key.modifiers.intersects(KeyModifiers::SHIFT | KeyModifiers::ALT) => self.typed.push('\n'),
            KeyCode::Enter => self.submit(false),
            KeyCode::Tab | KeyCode::BackTab => {
                let back = key.code == KeyCode::BackTab;
                if let Some(f) = self.feed_mut() {
                    let choices = f.choices();
                    let i = choices.iter().position(|c| *c == f.target()).unwrap_or(0);
                    let next = choices[(if back { i + choices.len() - 1 } else { i + 1 }) % choices.len()].clone();
                    f.to = Some(next.unwrap_or_else(|| EVERYONE.to_string()));
                }
            }
            KeyCode::Backspace => {
                self.typed.pop();
            }
            KeyCode::Up => self.scroll(|s| s + 1),
            KeyCode::Down => self.scroll(|s| s.saturating_sub(1)),
            KeyCode::PageUp => self.scroll(|s| s + page),
            KeyCode::PageDown => self.scroll(|s| s.saturating_sub(page)),
            KeyCode::Home => self.scroll(|_| usize::MAX / 2),
            KeyCode::End => self.scroll(|_| 0),
            KeyCode::Char('?') if self.typed.is_empty() => self.help = true, // in an empty box: every key, explained
            KeyCode::Char(c) if !ctrl => self.typed.push(c),
            _ => {}
        }
        true
    }

    fn scroll(&mut self, f: impl Fn(usize) -> usize) {
        if self.zoom.is_some() {
            self.zoom_scroll = f(self.zoom_scroll);
            return;
        }
        if let Some(feed) = self.feed_mut() {
            feed.scroll = f(feed.scroll);
            if feed.scroll == 0 {
                feed.unseen = 0;
            }
        }
    }

    /// Send what's typed. A working agent gets it when its turn ends; with `steer` (ctrl+enter), a working Codex
    /// helper gets it now, in the turn it's on.
    fn submit(&mut self, steer: bool) {
        let text = std::mem::take(&mut self.typed).trim().to_string();
        if text.is_empty() {
            return;
        }
        let Some(f) = self.feed_mut() else { return };
        f.scroll = 0;
        f.unseen = 0;
        let (code, ended, crew) = (f.h.code.clone(), f.ended, f.crew.clone());
        let to = self.zoom.clone().or_else(|| self.feed().and_then(|f| f.target())); // zoomed in, you talk to that agent
        if let Some(command) = text.strip_prefix('/') {
            return self.command(&code, ended, &crew, command);
        }
        let (mut name, mut body) = (to, text.as_str());
        if let Some(rest) = text.strip_prefix('@') {
            let word: String = rest.chars().take_while(|c| c.is_alphanumeric() || "_.-".contains(*c)).collect();
            if crew.names().contains(&word) || AGENTS.contains(&word.as_str()) {
                body = rest[word.len()..].trim_start();
                name = Some(word);
            }
        }
        if let Some(n) = name.clone() {
            if !crew.names().contains(&n) {
                let apps: Vec<String> = crew.active().filter(|m| m.agent == n).map(|m| m.name.clone()).collect();
                if apps.len() != 1 {
                    return self.say(format!("{} isn't in this huddle.", crew.label(&n)));
                }
                name = Some(apps[0].clone());
            }
        }
        if ended {
            return self.say("This huddle has ended.");
        }
        let deaf = name.as_ref().and_then(|n| {
            let f = self.feed()?;
            let m = f.crew.by_name(n)?;
            (!f.hears(m) && !busy(&f.state(m))).then(|| member_label(m))
        });
        if let Some(who) = deaf {
            self.notice = Some((format!("Sent. {who} isn't listening right now, so it sees this when it next checks the huddle."), Instant::now(), 10));
        }
        let steerable = name.as_ref().and_then(|n| {
            let f = self.feed()?;
            let m = f.crew.by_name(n)?;
            Some(m.helper && m.agent == "codex" && busy(&f.state(m)))
        });
        let mut args = vec!["say".to_string(), "-c".into(), code];
        if let Some(n) = name {
            args.push("--to".into());
            args.push(n);
        }
        if steer && steerable == Some(true) {
            args.push("--steer".into());
        } else if steer {
            self.say("Only a working Codex helper can be steered. Sent: it gets this when its turn ends.");
        }
        self.run(args, Some(body.to_string()));
    }

    fn command(&mut self, code: &str, ended: bool, crew: &Crew, command: &str) {
        let (word, arg) = command.split_once(' ').map(|(w, a)| (w, a.trim())).unwrap_or((command, ""));
        match word {
            "end" if ended => self.say("This huddle has already ended."),
            "end" => self.run(vec!["end".into(), code.into()], None),
            "stop" | "interrupt" => {
                let helpers: Vec<&Member> = crew.active().filter(|m| m.helper).collect();
                let target = helpers.iter().find(|m| m.name == arg).or_else(|| {
                    let apps: Vec<&&Member> = helpers.iter().filter(|m| m.agent == arg).collect();
                    (apps.len() == 1).then(|| apps[0])
                });
                match target {
                    Some(m) => self.run(vec![word.into(), m.name.clone(), "-c".into(), code.into()], None),
                    None => {
                        let names: Vec<String> = helpers.iter().map(|m| m.name.clone()).collect();
                        let names = if names.is_empty() { "there are none".to_string() } else { names.join(", ") };
                        self.say(format!("/{word} takes a helper's name: {names}"))
                    }
                }
            }
            _ => self.say("Commands: /stop NAME · /interrupt NAME · /end"),
        }
    }

    /// Run the huddle command as the user, off the drawing thread. Problems come back as a notice.
    fn run(&mut self, args: Vec<String>, stdin: Option<String>) {
        let cli = std::env::var("HUDDLE_CLI").unwrap_or_else(|_| "huddle".into());
        let tx = self.results.0.clone();
        std::thread::spawn(move || {
            let mut cmd = Command::new(&cli);
            cmd.args(&args)
                .env_remove("CLAUDE_CODE_SESSION_ID")
                .env_remove("CODEX_THREAD_ID")
                .env_remove("HUDDLE_MEMBER")
                .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            let outcome = cmd.spawn().and_then(|mut child| {
                if let (Some(text), Some(mut pipe)) = (stdin, child.stdin.take()) {
                    use std::io::Write;
                    let _ = pipe.write_all(text.as_bytes());
                }
                child.wait_with_output()
            });
            match outcome {
                Ok(out) if out.status.success() => {
                    let said = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    if args[0] != "say" && !said.is_empty() {
                        let _ = tx.send(said);
                    }
                }
                Ok(out) => {
                    let err = String::from_utf8_lossy(&out.stderr);
                    let _ = tx.send(err.lines().next().unwrap_or("huddle failed").to_string());
                }
                Err(e) => {
                    let _ = tx.send(format!("Couldn't run {cli}: {e}"));
                }
            }
        });
    }
}

/// The main checkout of the repo the watch runs in, so a repo and its worktrees count as one.
pub fn repo_root() -> String {
    Command::new("git")
        .args(["rev-parse", "--path-format=absolute", "--git-common-dir"])
        .stderr(Stdio::null())
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| {
            let p = std::path::PathBuf::from(String::from_utf8_lossy(&o.stdout).trim());
            p.parent().map(|p| p.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| std::env::current_dir().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::crossterm::event::{KeyEvent, KeyEventKind, KeyEventState};

    #[test]
    fn ctrl_w_after_a_wide_space_deletes_the_word_without_crashing() {
        let (_tx, rx) = std::sync::mpsc::sync_channel(1);
        let mut app = App::new(rx, None);
        app.typed = "first\\u{3000}second".replace("\\u{3000}", "\u{3000}");
        let key = KeyEvent { code: KeyCode::Char('w'), modifiers: KeyModifiers::CONTROL, kind: KeyEventKind::Press, state: KeyEventState::NONE };
        app.chat_key(key);
        assert_eq!(app.typed, "first\u{3000}");
    }
}
