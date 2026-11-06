//! Drawing, in the spirit of Grok's TUI: the conversation uses the whole width, each message's time sits at the
//! right edge, what you said is a shaded block, agents' messages are plain text under their name, and the input
//! is a box with who you're talking to set into its border. Or the list of running huddles to pick from.

use crate::app::{busy, member_label, App, Crew, Feed};
use crate::db::{Member, Message, Step};
use crate::markdown;
use chrono::TimeZone;
use ratatui::layout::{Constraint, Layout, Position, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Padding, Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState};
use ratatui::Frame;
use std::path::Path;
use unicode_width::UnicodeWidthStr;

const SPIN: [&str; 10] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const AMBER: Color = Color::Indexed(214);
const SHADE: Color = Color::Indexed(235);
const PAD: u16 = 2; // the margin on each side of everything

fn color(agent: &str) -> Color {
    match agent {
        "claude" => Color::Indexed(208),
        "codex" => Color::Indexed(75),
        _ => Color::Indexed(250),
    }
}

/// Each app's own mark, as its CLI shows it: Claude Code's ✻, Codex's >_. Drawn in the app's colour.
fn logo(agent: &str) -> Span<'static> {
    let mark = match agent {
        "claude" => "✻",
        "codex" => ">_",
        _ => "❯",
    };
    Span::styled(mark, Style::default().fg(color(agent)).add_modifier(Modifier::BOLD))
}

fn dim() -> Style {
    Style::default().add_modifier(Modifier::DIM)
}

fn bold() -> Style {
    Style::default().add_modifier(Modifier::BOLD)
}

fn clock(t: f64) -> String {
    chrono::Local.timestamp_opt(t as i64, 0).single().map(|d| d.format("%-I:%M %p").to_string()).unwrap_or_default()
}

fn repo_name(repo: &str) -> String {
    Path::new(repo).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| repo.to_string())
}

fn inset(area: Rect) -> Rect {
    Rect { x: area.x + PAD, width: area.width.saturating_sub(2 * PAD), ..area }
}

fn width_of(spans: &[Span]) -> usize {
    spans.iter().map(|s| s.content.width()).sum()
}

/// A line with `left` at the start and `right` against the far edge of `width` columns.
fn spread(mut left: Vec<Span<'static>>, right: Vec<Span<'static>>, width: usize) -> Line<'static> {
    let gap = width.saturating_sub(width_of(&left) + width_of(&right)).max(1);
    left.push(Span::raw(" ".repeat(gap)));
    left.extend(right);
    Line::from(left)
}

/// Shortcuts as Grok shows them: the key, then what it does, dimmed, between thin bars.
fn keys(pairs: &[(&str, &str)]) -> Line<'static> {
    let mut spans = vec![];
    for (i, (key, what)) in pairs.iter().enumerate() {
        if i > 0 {
            spans.push(Span::styled("  │  ", dim()));
        }
        spans.push(Span::raw(key.to_string()));
        spans.push(Span::styled(format!(":{what}"), dim()));
    }
    Line::from(spans)
}

const PEERS: [(&str, &str); 2] = [("claude", "Codex"), ("codex", "Claude")];

/// Who a message went to, as the watch shows it.
fn to_whom(m: &Message, crew: &Crew) -> String {
    match m.recipient.as_deref() {
        Some("you") => return "you".into(),
        Some(r) => return crew.label(r),
        None => {}
    }
    let others: Vec<String> = crew.names().into_iter().filter(|n| *n != m.sender).collect();
    if m.sender == "you" {
        return match others.len() {
            2 => "both".into(),
            1 => crew.label(&others[0]),
            _ => "everyone".into(),
        };
    }
    if others.len() == 1 {
        return crew.label(&others[0]);
    }
    if others.is_empty() {
        let agent = crew.agent(&m.sender);
        if let Some((_, peer)) = PEERS.iter().find(|(a, _)| *a == agent) {
            return peer.to_string();
        }
    }
    "everyone".into()
}

/// A message as lines `width` columns wide, followed by the blank line before the next one.
fn message(m: &Message, crew: &Crew, width: usize) -> Vec<Line<'static>> {
    if m.recipient.as_deref() == Some(crate::sessions::ACTIVITY) {
        return vec![]; // where a thread's turn began: its work is drawn here, not a message
    }
    let stamp = Span::styled(clock(m.sent_at), dim());
    if m.sender == "huddle" {
        let (who, rest) = m.text.split_once(' ').unwrap_or((m.text.as_str(), ""));
        let note = format!("◆ {} {}", crew.label(who), rest.trim_end_matches('.'));
        return vec![spread(vec![Span::styled(note, dim())], vec![stamp], width), Line::default()];
    }
    if m.sender == "you" {
        // what you said: a shaded block across the whole width, like Grok's prompts
        let shade = Style::default().bg(SHADE);
        let to = format!("to {} · ", to_whom(m, crew));
        let right = vec![Span::styled(to, dim().bg(SHADE)), Span::styled(clock(m.sent_at), dim().bg(SHADE))];
        let room = width.saturating_sub(4 + width_of(&right) + 2).max(10);
        let mut lines = vec![];
        let body = markdown::wrap(&[(m.text.clone(), bold().bg(SHADE))], room, vec![], vec![]);
        for (i, line) in body.into_iter().enumerate() {
            let mut left = vec![Span::styled(if i == 0 { "  ❯ " } else { "    " }, bold().bg(SHADE))];
            left.extend(line.spans.into_iter().map(|s| Span::styled(s.content, s.style.bg(SHADE))));
            let right = if i == 0 { right.clone() } else { vec![] };
            let gap = width.saturating_sub(width_of(&left) + width_of(&right) + 2).max(1);
            left.push(Span::styled(" ".repeat(gap), shade));
            left.extend(right);
            left.push(Span::styled("  ", shade));
            lines.push(Line::from(left));
        }
        lines.push(Line::default());
        return lines;
    }
    let agent = crew.agent(&m.sender);
    let reply = if m.reply_to.is_some() { " · reply" } else { "" };
    let mut lines = vec![spread(
        vec![
            Span::raw("  "),
            logo(&agent),
            Span::raw(" "),
            Span::styled(crew.label(&m.sender), bold()),
            Span::styled(format!("  → {}{}", to_whom(m, crew), reply), dim()),
        ],
        vec![stamp, Span::raw("  ")],
        width,
    )];
    for line in markdown::render(&m.text, width.saturating_sub(6)) {
        let mut spans = vec![Span::raw("    ")];
        spans.extend(line.spans);
        lines.push(Line::from(spans));
    }
    lines.push(Line::default());
    lines
}

/// Each message as lines at this width; only messages new since last time are drawn again.
fn drawn(f: &mut Feed, width: usize) {
    if width != f.drawn_width {
        f.drawn_width = width;
        f.cache.clear();
    }
    let crew = f.crew.clone();
    for m in &f.items[f.cache.len()..] {
        f.cache.push(message(m, &crew, width));
    }
}

/// The agent list's rows: each member and how deep it sits in the tree.
type Rows = Vec<(Member, usize)>;

// The zoom and its scroll, and the agent list, kept outside `Feed` so drawing can borrow the feed mutably.
thread_local! {
    static ZOOM: std::cell::RefCell<(Option<String>, usize)> = const { std::cell::RefCell::new((None, 0)) };
    /// The zoom's length when last drawn, and whose it was: scrolled up, new steps mustn't move what you're reading.
    static ZOOM_TOTAL: std::cell::RefCell<(Option<String>, usize)> = const { std::cell::RefCell::new((None, 0)) };
    static AGENTS: std::cell::RefCell<(bool, usize, Rows)> = const { std::cell::RefCell::new((false, 0, Vec::new())) };
    static HELP: std::cell::RefCell<bool> = const { std::cell::RefCell::new(false) };
}

/// Every key, said plainly: what the `?` panel shows.
fn help_lines() -> Vec<Line<'static>> {
    let mut lines = vec![Line::styled("  Keys", bold()), Line::default()];
    let groups: [(&str, &[(&str, &str)]); 4] = [
        ("Talking", &[
            ("Enter", "send what you typed (an agent that's working gets it when its turn ends)"),
            ("ctrl+enter", "steer: a working Codex helper gets it now, in the turn it's on"),
            ("Shift+Enter", "new line"),
            ("Tab", "choose who gets your message (shown under the box)"),
            ("@name", "start a message with a name to send it to that agent once"),
        ]),
        ("Agents", &[
            ("ctrl+o", "list the agents in this huddle, and the helpers each one started"),
            ("Enter on one", "a helper: open its real session (Codex: talk to it there too) · a thread you opened: follow it here"),
            ("Esc", "back to the conversation"),
        ]),
        ("Moving around", &[
            ("↑ ↓  PgUp PgDn", "scroll (the mouse wheel works too)"),
            ("End", "jump to the newest message"),
            ("Ctrl-N  Ctrl-P", "next or previous huddle, when several are running"),
            ("Esc", "list every running huddle, to switch to another (Enter or its number opens it)"),
        ]),
        ("Typing commands", &[
            ("/stop NAME", "shut a helper down (a message starts it again)"),
            ("/interrupt NAME", "stop a helper's current turn"),
            ("/end", "end this huddle"),
            ("Ctrl-D", "quit the watch"),
        ]),
    ];
    for (title, keys) in groups {
        lines.push(Line::styled(format!("  {title}"), dim()));
        for &(key, what) in keys {
            lines.push(Line::from(vec![Span::styled(format!("    {key:<18}"), bold()), Span::raw(what.to_string())]));
        }
        lines.push(Line::default());
    }
    lines.push(Line::styled("  Press any key to close this.", dim()));
    lines
}

fn help_open() -> bool {
    HELP.with(|h| *h.borrow())
}

fn agents_open() -> bool {
    AGENTS.with(|a| a.borrow().0)
}

fn agent_choice_now() -> usize {
    AGENTS.with(|a| a.borrow().1)
}

fn agent_rows_now() -> Vec<(Member, usize)> {
    AGENTS.with(|a| a.borrow().2.clone())
}

fn app_zoom(_current: Option<i64>, f: &Feed) -> Option<String> {
    ZOOM.with(|z| z.borrow().0.clone()).filter(|who| f.crew.names().contains(who))
}

fn zoom_scroll(who: &str, total: usize, height: usize) -> usize {
    let grew = ZOOM_TOTAL.with(|t| {
        let mut t = t.borrow_mut();
        let grew = if t.0.as_deref() == Some(who) { total.saturating_sub(t.1) } else { 0 };
        *t = (Some(who.to_string()), total);
        grew
    });
    ZOOM.with(|z| {
        let mut z = z.borrow_mut();
        if z.1 > 0 {
            z.1 += grew; // scrolled up: stay on the same lines; at the bottom (0): follow
        }
        z.1 = z.1.min(total.saturating_sub(height));
        z.1
    })
}

/// Lines of the conversation or a zoom, with the "more below" mark and the scrollbar.
#[allow(clippy::too_many_arguments)]
fn show(frame: &mut Frame, area: Rect, mut shown: Vec<Line<'static>>, height: usize, scroll: usize, unseen: usize, total: usize, start: usize) {
    if shown.len() < height {
        let mut padded = vec![Line::default(); height - shown.len()];
        padded.extend(shown);
        shown = padded;
    }
    if scroll > 0 {
        let more = if unseen > 0 { format!("▼ {unseen} new") } else { "▼".to_string() };
        if let Some(last) = shown.last_mut() {
            *last = Line::styled(more, dim()).centered();
        }
    }
    frame.render_widget(Paragraph::new(shown), Rect { width: area.width.saturating_sub(2), ..area });
    if total > height {
        let mut bar = ScrollbarState::new(total.saturating_sub(height)).position(start);
        frame.render_stateful_widget(
            Scrollbar::new(ScrollbarOrientation::VerticalRight)
                .begin_symbol(None)
                .end_symbol(None)
                .track_symbol(Some(" "))
                .thumb_symbol("▐")
                .thumb_style(Style::default().fg(Color::Indexed(240))),
            area,
            &mut bar,
        );
    }
}

const GREEN: Color = Color::Indexed(114);

/// Whether a finished turn keeps its steps on screen (true) or folds to just its answer (false), in the conversation
/// and in the live view. On while we see how it reads; false brings back the folding.
const KEEP_STEPS: bool = true;
const RED: Color = Color::Indexed(203);

fn cut(text: &str, width: usize) -> String {
    if text.width() <= width {
        return text.to_string();
    }
    let mut out = String::new();
    for c in text.chars() {
        if out.width() + 2 > width {
            break;
        }
        out.push(c);
    }
    out + "…"
}

/// The bullet that leads a step, as Claude Code draws its tool calls: green once it worked, red if it failed,
/// a spinner while it runs, plain for what the agent says.
fn bullet(st: &Step, s: &str) -> Span<'static> {
    match (st.kind.as_str(), st.status.as_deref()) {
        ("say", _) => Span::raw("● "),
        ("think", _) => Span::styled("∴ ", dim()),
        (_, Some("running")) => Span::styled(format!("{s} "), Style::default().fg(AMBER)),
        (_, Some("failed")) => Span::styled("● ", Style::default().fg(RED)),
        _ => Span::styled("● ", Style::default().fg(GREEN)),
    }
}

/// Text wrapped to width, each line led by `first` then `rest`, at most `cap` lines (the last ends in "…").
fn wrapped(text: &str, width: usize, first: Vec<Span<'static>>, rest: Vec<Span<'static>>, style: Style, cap: usize) -> Vec<Line<'static>> {
    let mut lines = markdown::wrap(&[(text.to_string(), style)], width, first, rest);
    if lines.len() > cap {
        lines.truncate(cap);
        if let Some(last) = lines.last_mut() {
            last.spans.push(Span::styled(" …", dim()));
        }
    }
    lines
}

/// Output under a step: "  ⎿  first line", the next few, then "… +N lines".
fn result(text: &str, width: usize, cap: usize) -> Vec<Line<'static>> {
    let all: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    let mut lines = vec![];
    for (i, l) in all.iter().take(cap).enumerate() {
        let lead = if i == 0 { "  ⎿  " } else { "     " };
        lines.push(Line::from(vec![Span::styled(lead, dim()), Span::styled(cut(l, width.saturating_sub(5)), dim())]));
    }
    if all.len() > cap {
        lines.push(Line::styled(format!("     … +{} lines", all.len() - cap), dim()));
    }
    lines
}

// Claude Code's diff colours, as it draws them on a dark screen (measured from it; its newer diff renderer is darker
// than its theme's values): a changed line's background, brighter behind the words that changed, and its number.
const ADDED: Color = Color::Rgb(8, 38, 8);
const REMOVED: Color = Color::Rgb(58, 7, 7);
const ADDED_WORD: Color = Color::Rgb(11, 68, 14);
const REMOVED_WORD: Color = Color::Rgb(89, 9, 11);
const ADDED_NUMBER: Color = Color::Rgb(80, 210, 88);
const REMOVED_NUMBER: Color = Color::Rgb(235, 89, 91);
/// The text on a changed line: white, a little brighter than the rest.
const CHANGED_TEXT: Color = Color::Rgb(255, 255, 255);

/// What a removed line and the added line that replaced it have in common at each end, in characters, kept to
/// whole words: what's between is what changed.
fn common_ends(old: &str, new: &str) -> (usize, usize) {
    let (a, b): (Vec<char>, Vec<char>) = (old.chars().collect(), new.chars().collect());
    let mut pre = a.iter().zip(&b).take_while(|(x, y)| x == y).count();
    while pre > 0 && pre < a.len().min(b.len()) && a[pre - 1].is_alphanumeric() && a[pre].is_alphanumeric() {
        pre -= 1;
    }
    let room = a.len().min(b.len()) - pre;
    let mut suf = a.iter().rev().zip(b.iter().rev()).take(room).take_while(|(x, y)| x == y).count();
    while suf > 0 && suf < room && a[a.len() - suf].is_alphanumeric() && a[a.len() - suf - 1].is_alphanumeric() {
        suf -= 1;
    }
    (pre, suf)
}

/// A diff as Claude Code shows one: line numbers in a gutter; removed lines on red and added lines on green right
/// across the width, with the words that changed brighter; hunks apart by a dotted line. At most `cap` lines of
/// the diff (wrapped onto as many rows as they take), then "… +N lines".
fn diff(text: &str, width: usize, cap: usize) -> Vec<Line<'static>> {
    let hunk = regex_hunk();
    let body: Vec<&str> = text.lines().filter(|l| !l.starts_with("--- ") && !l.starts_with("+++ ")).collect();
    // a new file's content as it came (no hunks, no signs): all of it added, numbered from 1
    let whole_file = !body.iter().any(|l| l.starts_with("@@") || l.starts_with('+') || l.starts_with('-'));
    // each row: sign ('-', '+', ' ', or '@' between hunks), its number, its text
    let (mut old, mut new, mut numbered) = (0i64, if whole_file { 1 } else { 0 }, whole_file);
    let mut rows: Vec<(char, i64, String)> = vec![];
    for line in body {
        if !whole_file && line.starts_with("@@") {
            if let Some(c) = hunk.captures(line) {
                old = c[1].parse().unwrap_or(0);
                new = c[2].parse().unwrap_or(0);
                numbered = true;
            }
            if !rows.is_empty() {
                rows.push(('@', 0, String::new()));
            }
            continue;
        }
        let (sign, rest) = if whole_file {
            ('+', line)
        } else {
            match line.chars().next() {
                Some(c @ ('-' | '+' | ' ')) => (c, &line[1..]),
                _ => (' ', line),
            }
        };
        let num = match sign {
            '-' => {
                old += 1;
                old - 1
            }
            '+' => {
                new += 1;
                new - 1
            }
            _ => {
                old += 1;
                new += 1;
                new - 1
            }
        };
        rows.push((sign, num, rest.to_string()));
    }
    // pair each run of removed lines with the run of added lines after it: those are the changed words
    let mut changed: Vec<Option<(usize, usize)>> = vec![None; rows.len()];
    let mut k = 0;
    while k < rows.len() {
        if rows[k].0 != '-' {
            k += 1;
            continue;
        }
        let gone = k;
        while k < rows.len() && rows[k].0 == '-' {
            k += 1;
        }
        let came = k;
        while k < rows.len() && rows[k].0 == '+' {
            k += 1;
        }
        for n in 0..(came - gone).min(k - came) {
            let (pre, suf) = common_ends(&rows[gone + n].2, &rows[came + n].2);
            changed[gone + n] = Some((pre, suf));
            changed[came + n] = Some((pre, suf));
        }
    }
    let mut lines: Vec<Line<'static>> = vec![];
    let mut shown = 0; // lines of the diff shown so far (a wrapped line counts once)
    for (n, (sign, num, text)) in rows.iter().enumerate() {
        if *sign == '@' {
            lines.push(Line::styled("       ⋮", dim()));
            continue;
        }
        let (line_bg, word_bg) = match sign {
            '-' => (Some(REMOVED), REMOVED_WORD),
            '+' => (Some(ADDED), ADDED_WORD),
            _ => (None, Color::Reset),
        };
        let base = line_bg.map(|c| Style::default().bg(c).fg(CHANGED_TEXT)).unwrap_or_default();
        // as Claude Code numbers a line: the number in red or green on a changed line, dim on the rest, then the
        // sign right against the text
        let gutter = if numbered { format!("{num:>6} ") } else { "       ".into() };
        let number = match sign {
            '-' => base.fg(REMOVED_NUMBER),
            '+' => base.fg(ADDED_NUMBER),
            _ => dim(),
        };
        let mut spans = vec![Span::styled(gutter, number), Span::styled(sign.to_string(), base)];
        let chars: Vec<char> = text.chars().collect();
        match changed[n] {
            Some((pre, suf)) if pre + suf < chars.len() => {
                let mid_end = chars.len() - suf;
                spans.push(Span::styled(chars[..pre].iter().collect::<String>(), base));
                spans.push(Span::styled(chars[pre..mid_end].iter().collect::<String>(), base.bg(word_bg)));
                spans.push(Span::styled(chars[mid_end..].iter().collect::<String>(), base));
            }
            _ => spans.push(Span::styled(text.clone(), base)),
        }
        // wrapped as Claude Code wraps a diff: the rest of a long line on rows of its own under the text, broken
        // between words where it can be, the line's colour right across each row
        let lead = spans[0].content.width() + spans[1].content.width();
        let room = width.saturating_sub(lead).max(10);
        let cells: Vec<(char, Style)> = spans[2..].iter().flat_map(|sp| sp.content.chars().map(move |c| (c, sp.style))).collect();
        let mut breaks: Vec<(usize, usize)> = vec![]; // each row's [from, to) in cells
        let mut from = 0;
        while from < cells.len() {
            let (mut to, mut used) = (from, 0);
            while to < cells.len() && used + cells[to].0.to_string().width() <= room {
                used += cells[to].0.to_string().width();
                to += 1;
            }
            if to < cells.len() {
                if let Some(space) = (from + 1..to).rev().find(|&i| cells[i - 1].0 == ' ') {
                    to = space;
                }
            }
            breaks.push((from, to));
            from = to;
        }
        if breaks.is_empty() {
            breaks.push((0, 0));
        }
        for (r, (a, b)) in breaks.into_iter().enumerate() {
            // a wrapped row of a changed line starts with its sign again, as in Claude Code
            let mut row: Vec<Span<'static>> = if r == 0 {
                spans[..2].to_vec()
            } else if line_bg.is_some() {
                vec![Span::styled(" ".repeat(lead - 1), base), Span::styled(sign.to_string(), base)]
            } else {
                vec![Span::raw(" ".repeat(lead))]
            };
            let mut k = a;
            while k < b {
                let style = cells[k].1;
                let mut text = String::new();
                while k < b && cells[k].1 == style {
                    text.push(cells[k].0);
                    k += 1;
                }
                row.push(Span::styled(text, style));
            }
            let filled = width_of(&row);
            if line_bg.is_some() && filled < width {
                row.push(Span::styled(" ".repeat(width - filled), base));
            }
            lines.push(Line::from(row));
        }
        shown += 1;
        if shown >= cap && n + 1 < rows.len() {
            let more = rows[n + 1..].iter().filter(|r| r.0 != '@').count();
            lines.push(Line::styled(format!("       … +{more} lines"), dim()));
            return lines;
        }
    }
    lines
}

fn regex_hunk() -> &'static regex::Regex {
    static R: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    R.get_or_init(|| regex::Regex::new(r"^@@ -(\d+)(?:,\d+)? \+(\d+)").unwrap())
}

/// Finished steps as drawn, by (step id, live view or not): (its last change, the width, its lines).
pub type Traced = std::collections::HashMap<(i64, bool), (f64, usize, Vec<Line<'static>>)>;

/// A step's lines, from the cache when it's finished and unchanged at this width (a running one has a timer and a
/// spinner, so it's drawn fresh).
fn traced(cache: &mut Traced, st: &Step, width: usize, s: &str, full: bool) -> Vec<Line<'static>> {
    if st.status.as_deref() == Some("running") {
        return trace(st, width, s, full);
    }
    if let Some((updated, w, lines)) = cache.get(&(st.id, full)) {
        if *updated == st.updated && *w == width {
            return lines.clone();
        }
    }
    let lines = trace(st, width, s, full);
    cache.insert((st.id, full), (st.updated, width, lines.clone()));
    lines
}

/// One step, laid out the way Claude Code lays out its work: what it said; its thinking, dimmed; each tool call as
/// "● Tool(argument)" with its result under "⎿"; edits as a numbered diff. `full` (the zoom) shows everything; the
/// conversation keeps output and diffs short.
fn trace(st: &Step, width: usize, s: &str, full: bool) -> Vec<Line<'static>> {
    let detail = st.detail.clone().unwrap_or_default();
    let (out_cap, diff_cap, think_cap, arg_cap) = if full { (5, 40, 6, 3) } else { (3, 16, 3, 2) };
    let call = |tool: &str, arg: &str| -> Vec<Line<'static>> {
        // "● Tool(argument)": the argument's own lines kept (a script reads as a script), wrapped, at most arg_cap
        let mut lines = vec![];
        let parts: Vec<&str> = arg.trim_end().split('\n').collect();
        for (i, part) in parts.iter().enumerate() {
            let first = if i == 0 { vec![bullet(st, s), Span::styled(tool.to_string(), bold()), Span::raw("(")] } else { vec![Span::raw("    ")] };
            lines.extend(markdown::wrap(&[(part.to_string(), Style::default())], width, first, vec![Span::raw("    ")]));
            if lines.len() >= arg_cap {
                break;
            }
        }
        let more = lines.len() > arg_cap || parts.len() > 1 && lines.len() >= arg_cap;
        lines.truncate(arg_cap.max(1));
        if let Some(last) = lines.last_mut() {
            last.spans.push(Span::raw(if more { " …)" } else { ")" }));
        }
        lines
    };
    let mut lines = match st.kind.as_str() {
        "say" => {
            let mut lines = vec![];
            for (i, l) in markdown::render(&detail, width.saturating_sub(2)).into_iter().enumerate() {
                let mut spans = vec![if i == 0 { bullet(st, s) } else { Span::raw("  ") }];
                spans.extend(l.spans);
                lines.push(Line::from(spans));
            }
            if st.title == "steered by you" {
                lines.insert(0, Line::styled("  you steered it:", dim()));
            }
            lines
        }
        "think" => {
            let italic = dim().add_modifier(Modifier::ITALIC);
            let text = detail.replace("**", "");
            wrapped(&text, width, vec![bullet(st, s)], vec![Span::raw("  ")], italic, think_cap)
        }
        "run" => match st.title.split_once('\u{1f}') {
            // as Claude Code shows a command it was given words for: those words, then "$ command", then its output
            Some((desc, cmd)) => {
                let mut lines = wrapped(desc, width, vec![bullet(st, s)], vec![Span::raw("  ")], bold(), 2);
                let parts: Vec<&str> = cmd.trim_end().split('\n').collect();
                for (i, part) in parts.iter().take(arg_cap).enumerate() {
                    let lead = if i == 0 { "  ⎿  $ " } else { "       " };
                    let more = i + 1 == arg_cap.min(parts.len()) && parts.len() > arg_cap;
                    let text = cut(part, width.saturating_sub(8)) + if more { " …" } else { "" };
                    lines.push(Line::from(vec![Span::styled(lead, dim()), Span::styled(text, dim())]));
                }
                let out: Vec<Line<'static>> = result(&detail, width, out_cap)
                    .into_iter()
                    .map(|l| Line::from(l.spans.into_iter().map(|sp| Span::styled(sp.content.replace("⎿", " "), sp.style)).collect::<Vec<_>>()))
                    .collect();
                lines.extend(out);
                lines.extend(running_for(st, "     "));
                lines
            }
            None => {
                let mut lines = call("Bash", &st.title);
                lines.extend(result(&detail, width, out_cap));
                if detail.trim().is_empty() && st.status.as_deref() != Some("running") {
                    lines.push(Line::styled("  ⎿  (no output)", dim()));
                }
                lines.extend(running_for(st, "  ⎿  "));
                lines
            }
        },
        "edit" => {
            let path = detail.lines().next().and_then(|l| l.strip_prefix("--- ")).unwrap_or(&st.title).to_string();
            let new_file = st.title.contains("(new");
            let mut lines = call(if new_file { "Write" } else { "Update" }, &path);
            let counts = st.title.rsplit("  ").next().unwrap_or("").to_string();
            let what = if new_file {
                format!("Wrote {}", counts.trim_matches(|c| c == '(' || c == ')').replace("new, ", ""))
            } else {
                // as Claude Code says it: "Added 2 lines, removed 1 line"
                let n = |sign: char| counts.split_whitespace().find_map(|w| w.strip_prefix(sign).and_then(|x| x.parse::<usize>().ok())).unwrap_or(0);
                let lines = |k: usize| format!("{k} line{}", if k == 1 { "" } else { "s" });
                match (n('+'), n('−')) {
                    (0, 0) => format!("Updated {}", file_label(&path)),
                    (a, 0) => format!("Added {}", lines(a)),
                    (0, r) => format!("Removed {}", lines(r)),
                    (a, r) => format!("Added {}, removed {}", lines(a), lines(r)),
                }
            };
            lines.push(Line::from(vec![Span::styled("  ⎿  ", dim()), Span::raw(what)]));
            lines.extend(diff(&detail, width, diff_cap));
            lines
        }
        "read" => {
            let mut lines = call("Read", &st.title);
            if !detail.is_empty() {
                lines.push(Line::styled(format!("  ⎿  {detail}"), dim()));
            }
            lines
        }
        "search" => {
            let mut lines = call("Search", &st.title);
            lines.extend(result(&detail, width, out_cap.min(3)));
            lines
        }
        "plan" => {
            let mut lines = vec![Line::from(vec![bullet(st, s), Span::styled("Plan", bold())])];
            for (i, l) in detail.lines().enumerate() {
                let (mark, rest, style) = if let Some(r) = l.strip_prefix("[x] ") {
                    ("☒ ", r, dim().add_modifier(Modifier::CROSSED_OUT))
                } else if let Some(r) = l.strip_prefix("[~] ") {
                    ("◼ ", r, bold())
                } else {
                    ("☐ ", l.strip_prefix("[ ] ").unwrap_or(l), Style::default())
                };
                let lead = if i == 0 { "  ⎿  " } else { "     " };
                lines.push(Line::from(vec![Span::styled(lead, dim()), Span::raw(mark), Span::styled(cut(rest, width.saturating_sub(8)), style)]));
            }
            lines
        }
        _ => {
            let mut lines = call(&st.title, "");
            lines.extend(result(&detail, width, out_cap.min(3)));
            lines
        }
    };
    lines.push(Line::default());
    lines
}

/// While a command runs, how long it's been going, as Claude Code counts it: "Running… (12s)".
fn running_for(st: &Step, lead: &str) -> Option<Line<'static>> {
    if st.status.as_deref() != Some("running") {
        return None;
    }
    let secs = (crate::db::now() - st.at).max(0.0) as u64;
    let took = if secs < 60 { format!("{secs}s") } else { format!("{}m {}s", secs / 60, secs % 60) };
    Some(Line::from(vec![Span::styled(lead.to_string(), dim()), Span::styled(format!("Running… ({took})"), dim())]))
}

fn file_label(path: &str) -> String {
    Path::new(path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string())
}

/// The conversation as lines, the way Claude Code shows its transcript: each message, and under the one an agent
/// is working on, its latest steps as they happen; once it's done, only its answer stays.
fn conversation(f: &mut Feed, width: usize, s: &str, pins: &mut Vec<(usize, String)>) -> Vec<Line<'static>> {
    drawn(f, width);
    let mut cache = std::mem::take(&mut f.traced);
    let mut turns: std::collections::HashMap<i64, Vec<&Step>> = std::collections::HashMap::new();
    for st in f.steps.values() {
        if let Some(t) = st.turn {
            turns.entry(t).or_default().push(st);
        }
    }
    let latest: std::collections::HashMap<&str, i64> =
        f.steps.values().filter_map(|st| st.turn.map(|t| (st.member.as_str(), t))).collect();
    let replies: std::collections::HashSet<i64> = f.items.iter().filter_map(|x| x.reply_to).collect();
    let is_live = |m: &Message, steps: &[&Step]| {
        let who = &steps[0].member;
        f.crew.by_name(who).map(|x| busy(&f.state(x))).unwrap_or(false)
            && latest.get(who.as_str()) == Some(&m.id)
            && !replies.contains(&m.id)
    };
    // what you said to an agent while it was mid-turn sits among its steps, where it arrived, as in Claude Code
    let mut inside: std::collections::HashMap<usize, Vec<usize>> = std::collections::HashMap::new();
    let mut absorbed: std::collections::HashSet<usize> = std::collections::HashSet::new();
    for (i, m) in f.items.iter().enumerate() {
        if let Some(steps) = turns.get(&m.id).filter(|st| m.id != 0 && (KEEP_STEPS || is_live(m, st))) {
            let who = steps[0].member.as_str();
            // a finished turn ends with its last step; a running one hasn't ended
            let until = if is_live(m, steps) { f64::MAX } else { steps.iter().map(|st| st.updated).fold(0.0, f64::max) };
            for (j, x) in f.items.iter().enumerate().skip(i + 1) {
                if x.sender == "you" && x.recipient.as_deref() == Some(who) && x.sent_at >= m.sent_at && x.sent_at <= until
                    && !absorbed.contains(&j)
                {
                    inside.entry(i).or_default().push(j);
                    absorbed.insert(j);
                }
            }
        }
    }
    let mut out = Vec::with_capacity(f.cache.iter().map(Vec::len).sum::<usize>() + 16);
    for (i, m) in f.items.iter().enumerate() {
        if absorbed.contains(&i) {
            continue; // drawn among the steps of the turn it arrived in
        }
        if m.sender == "you" {
            pins.push((out.len(), first_paragraph(&m.text))); // what stays at the top once it's scrolled past
        }
        out.extend(f.cache[i].iter().cloned());
        if let Some(steps) = turns.get(&m.id).filter(|_| m.id != 0) {
            let who = steps[0].member.clone();
            let agent = f.crew.agent(&who);
            let live = KEEP_STEPS || is_live(m, steps);
            let name = vec![Span::raw("  "), logo(&agent), Span::raw(" "), Span::styled(f.crew.label(&who), bold())];
            if live {
                out.push(Line::from(name));
                // every step while we keep steps on screen (each one kept short); else the latest few
                let shown_count = if KEEP_STEPS { steps.len() } else { 6 };
                let shown = &steps[steps.len().saturating_sub(shown_count)..];
                let from = shown.first().map(|st| st.at).unwrap_or(f64::MAX);
                let said: Vec<usize> = inside.get(&i).cloned().unwrap_or_default();
                // what you said before the steps shown, then the "earlier steps" note, then steps and what you
                // said in the order they happened
                for &j in said.iter().filter(|&&j| f.items[j].sent_at < from) {
                    out.extend(f.cache[j].iter().cloned());
                }
                if steps.len() > shown_count {
                    out.push(Line::styled(format!("    … {} earlier steps · ctrl+o to see them", steps.len() - shown_count), dim()));
                }
                let mut pending: Vec<usize> = said.into_iter().filter(|&j| f.items[j].sent_at >= from).collect();
                for st in shown {
                    while let Some(&j) = pending.first().filter(|&&j| f.items[j].sent_at <= st.at) {
                        out.extend(f.cache[j].iter().cloned());
                        pending.remove(0);
                    }
                    for line in traced(&mut cache, st, width.saturating_sub(4), s, false) {
                        let mut spans = vec![Span::raw("    ")];
                        spans.extend(line.spans);
                        out.push(Line::from(spans));
                    }
                }
                for j in pending {
                    out.extend(f.cache[j].iter().cloned());
                }
            }
            // a finished turn leaves only its answer here; what it did is in the live view (ctrl+o)
        }
        // under what you sent, only when it will really sit: an idle thread that isn't listening hasn't taken it in
        let to = m.recipient.clone().unwrap_or_default();
        let stuck = f.crew.by_name(&to).map(|x| !f.hears(x) && !busy(&f.state(x))).unwrap_or(false);
        if stuck && !f.seen(m) {
            if out.last().map(|l| l.width() == 0).unwrap_or(false) {
                out.pop();
            }
            let note = format!("· {} isn't listening, so it sees this when it next checks the huddle", f.crew.label(&to));
            out.push(Line::from(vec![Span::raw("    "), Span::styled(note, dim())]));
            out.push(Line::default());
        }
    }
    f.traced = cache;
    out
}

/// A prompt as one line: its first paragraph, whitespace collapsed (what Claude Code pins).
fn first_paragraph(text: &str) -> String {
    let text = text.trim_start();
    let end = text.find("\n\n").unwrap_or(text.len());
    text[..end].split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The agent list (Ctrl-O): every member as a tree, the helpers under the thread that started them, like a sidebar.
fn agent_list(f: &Feed, rows: &[(Member, usize)], choice: usize, width: usize, s: &str) -> Vec<Line<'static>> {
    let mut lines = vec![Line::styled("  Agents in this huddle", bold()), Line::default()];
    for (i, (m, depth)) in rows.iter().enumerate() {
        let chosen = i == choice;
        let shade = if chosen { Style::default().bg(SHADE) } else { Style::default() };
        let state = f.state(m);
        let lead = format!("  {}{}", "   ".repeat(*depth), if *depth > 0 { "└ " } else { "" });
        let what = if m.helper { format!("{} helper", crate::app::app_name(&m.agent)) } else { "thread you opened".into() };
        let opens = if !m.helper {
            "Enter: go to it"
        } else if busy(&state) && !m.shared {
            "Enter: follow it live"
        } else {
            "Enter: open its session"
        };
        let left = vec![
            Span::styled(format!("{lead}{} ", if chosen { "❯" } else { " " }), bold().patch(shade)),
            logo(&m.agent).patch_style(shade),
            Span::styled(format!(" {}", m.name), bold().patch(shade)),
            Span::styled(format!("  {what}"), dim().patch(shade)),
        ];
        let state_span = if busy(&state) {
            Span::styled(format!("{s} {state}"), Style::default().fg(color(&m.agent)).patch(shade))
        } else {
            Span::styled(state, dim().patch(shade))
        };
        let mut right = vec![state_span];
        if chosen {
            right.push(Span::styled(format!("   {opens}"), dim().patch(shade)));
        }
        right.push(Span::styled("  ", shade));
        let line = spread(left, right, width);
        lines.push(if chosen { Line::from(line.spans.into_iter().map(|sp| Span::styled(sp.content, sp.style.patch(shade))).collect::<Vec<_>>()) } else { line });
    }
    lines.push(Line::default());
    lines.push(Line::styled("  ↑↓ choose  ·  Enter open  ·  Esc back", dim()));
    lines
}

/// One member's work, turn by turn, as Claude Code shows it: the turn it's on, step by step as it happens; each
/// finished turn folded into one line of what it did, followed by its answer.
fn zoom_lines(f: &Feed, who: &str, width: usize, s: &str, pins: &mut Vec<(usize, String)>, cache: &mut Traced) -> Vec<Line<'static>> {
    let mut lines = vec![];
    let m = f.crew.by_name(who);
    let agent = f.crew.agent(who);
    let working = m.map(|m| busy(&f.state(m))).unwrap_or(false);
    lines.push(Line::from(vec![
        logo(&agent),
        Span::raw(" "),
        Span::styled(f.crew.label(who), bold()),
        Span::styled(format!("  {}", m.map(|m| f.state(m)).unwrap_or_default()), dim()),
    ]));
    lines.push(Line::styled("esc back to the conversation  ·  ctrl+o agents", dim()));
    lines.push(Line::default());
    // its steps, by turn, in order
    let mut turns: Vec<(Option<i64>, Vec<&Step>)> = vec![];
    for st in f.steps.values().filter(|st| st.member == who) {
        match turns.last_mut() {
            Some((t, steps)) if *t == st.turn => steps.push(st),
            _ => turns.push((st.turn, vec![st])),
        }
    }
    if turns.is_empty() {
        lines.push(Line::styled("Nothing yet. Its steps show here as it works.", dim()));
    }
    let last = turns.len().saturating_sub(1);
    let began = |turn: &Option<i64>| turn.and_then(|t| f.items.iter().find(|x| x.id == t)).map(|a| a.sent_at);
    for (k, (turn, steps)) in turns.iter().enumerate() {
        let asked = turn.and_then(|t| f.items.iter().find(|x| x.id == t));
        // its answer: a helper's reply to the message; for a thread the user opened, the last thing it said
        // before its next turn began
        let until = turns.get(k + 1).and_then(|(t, _)| began(t)).unwrap_or(f64::MAX);
        let reply = turn.and_then(|t| f.items.iter().find(|x| x.reply_to == Some(t) && x.sender == who)).or_else(|| {
            let from = asked.filter(|a| a.recipient.as_deref() == Some(crate::sessions::ACTIVITY))?.sent_at;
            f.items.iter().rev().find(|x| {
                x.sender == who && x.recipient.as_deref() != Some(crate::sessions::ACTIVITY) && x.sent_at >= from && x.sent_at < until
            })
        });
        let head = asked
            .map(|a| if a.recipient.as_deref() == Some(crate::sessions::ACTIVITY) {
                format!("── {} ", clock(a.sent_at))
            } else {
                format!("── {}: {} ", f.crew.label(&a.sender), a.text.lines().next().unwrap_or(""))
            })
            .unwrap_or_else(|| "── ".to_string());
        let head = cut(&head, width.saturating_sub(2));
        pins.push((lines.len(), head.trim_start_matches("── ").trim().to_string()));
        let pad = "─".repeat(width.saturating_sub(head.width()));
        lines.push(Line::styled(head + &pad, dim()));
        lines.push(Line::default());
        let live = k == last && working && reply.is_none();
        if live || KEEP_STEPS {
            for st in steps {
                lines.extend(traced(cache, st, width, s, true));
            }
            if live {
                continue;
            }
            if let Some(r) = reply {
                lines.extend(answer(r, width));
            }
            continue;
        }
        let start = asked.map(|a| a.sent_at).into_iter().chain(steps.iter().map(|st| st.at)).fold(f64::MAX, f64::min);
        let end = reply.map(|r| r.sent_at).into_iter().chain(steps.iter().map(|st| st.updated)).fold(0.0, f64::max);
        lines.push(summary(steps, start, end));
        lines.push(Line::default());
        if let Some(r) = reply {
            lines.extend(answer(r, width));
        }
    }
    lines
}

/// A finished turn in one line: "● Worked 3m 42s · ran 12 commands · edited 3 files +40 −12 · read 5 files".
fn summary(steps: &[&Step], start: f64, end: f64) -> Line<'static> {
    let count = |kind: &str| steps.iter().filter(|st| st.kind == kind).count();
    let (mut added, mut removed) = (0i64, 0i64);
    let mut files = std::collections::HashSet::new();
    for st in steps.iter().filter(|st| st.kind == "edit") {
        files.insert(st.title.split("  ").next().unwrap_or("").to_string());
        for word in st.title.split_whitespace() {
            if let Some(n) = word.strip_prefix('+').and_then(|n| n.parse::<i64>().ok()) {
                added += n;
            } else if let Some(n) = word.strip_prefix('−').and_then(|n| n.parse::<i64>().ok()) {
                removed += n;
            }
        }
    }
    let plural = |n: usize, one: &str, many: &str| format!("{n} {}", if n == 1 { one } else { many });
    let mut parts = vec![];
    if end > start && start < f64::MAX {
        let secs = (end - start) as u64;
        parts.push(if secs >= 60 { format!("Worked {}m {}s", secs / 60, secs % 60) } else { format!("Worked {secs}s") });
    } else {
        parts.push("Done".to_string());
    }
    if count("run") > 0 {
        parts.push(format!("ran {}", plural(count("run"), "command", "commands")));
    }
    if !files.is_empty() {
        parts.push(format!("edited {} +{added} −{removed}", plural(files.len(), "file", "files")));
    }
    if count("read") > 0 {
        parts.push(format!("read {}", plural(count("read"), "file", "files")));
    }
    if count("search") > 0 {
        parts.push(format!("searched {}", plural(count("search"), "time", "times")));
    }
    Line::from(vec![Span::styled("● ", Style::default().fg(GREEN)), Span::styled(parts.join(" · "), dim())])
}

fn answer(reply: &Message, width: usize) -> Vec<Line<'static>> {
    let mut lines = vec![Line::from(vec![Span::styled("● ", Style::default().fg(GREEN)), Span::styled("answered", bold())])];
    for l in markdown::render(&reply.text, width.saturating_sub(2)) {
        let mut spans = vec![Span::raw("  ")];
        spans.extend(l.spans);
        lines.push(Line::from(spans));
    }
    lines.push(Line::default());
    lines
}

pub fn draw(frame: &mut Frame, app: &mut App) {
    let rows = app.agent_rows();
    app.agent_choice = app.agent_choice.min(rows.len().saturating_sub(1));
    AGENTS.with(|a| *a.borrow_mut() = (app.agents, app.agent_choice, rows));
    HELP.with(|h| *h.borrow_mut() = app.help);
    ZOOM.with(|z| {
        let mut z = z.borrow_mut();
        z.0 = app.zoom.clone();
        z.1 = app.zoom_scroll;
    });
    if app.picking || app.feed().is_none() {
        picker(frame, app);
    } else {
        chat(frame, app);
    }
    app.zoom_scroll = ZOOM.with(|z| z.borrow().1);
}

fn spin(app: &App) -> &'static str {
    SPIN[(app.born.elapsed().as_millis() / 100) as usize % SPIN.len()]
}

fn footer_line(app: &App, pairs: &[(&str, &str)]) -> Line<'static> {
    match &app.notice {
        Some((text, _, _)) => Line::styled(text.clone(), Style::default().fg(AMBER)),
        None => keys(pairs),
    }
}

/// How long ago, said briefly: "just now", "4m ago", "2h ago", "3d ago".
fn ago(t: f64) -> String {
    let secs = (crate::db::now() - t).max(0.0) as u64;
    match secs {
        0..=59 => "just now".into(),
        60..=3599 => format!("{}m ago", secs / 60),
        3600..=86399 => format!("{}h ago", secs / 3600),
        _ => format!("{}d ago", secs / 86400),
    }
}

/// The last thing said in a huddle, on one line: "Codex: The positioning promises more than…".
fn last_said(f: &Feed) -> Option<(String, String)> {
    let m = f.items.iter().rev().find(|m| m.recipient.as_deref() != Some(crate::sessions::ACTIVITY) && !m.text.trim().is_empty())?;
    let text = m
        .text
        .lines()
        .map(|l| l.trim().trim_start_matches(['#', '>', '-', '*', ' ']).trim())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .replace("**", "")
        .replace('`', "");
    Some((f.crew.label(&m.sender), text))
}

/// One huddle in the list: its number and name, who's in it and what they're doing, and the last thing said.
fn huddle_card(f: &Feed, chosen: bool, here: &str, width: usize, s: &str) -> Vec<Line<'static>> {
    let bg = if chosen { Style::default().bg(SHADE) } else { Style::default() };
    let bar = Span::styled(if chosen { "▌ " } else { "  " }, bold().patch(bg));
    let fill = |mut spans: Vec<Span<'static>>| -> Line<'static> {
        let pad = width.saturating_sub(width_of(&spans));
        spans.push(Span::raw(" ".repeat(pad)));
        Line::from(spans.into_iter().map(|sp| Span::styled(sp.content, sp.style.patch(bg))).collect::<Vec<_>>())
    };
    // the name, with when something last happened at the right
    let place = if f.h.repo != here { format!("{} · ", repo_name(&f.h.repo)) } else { String::new() };
    let when = Span::styled(format!("{place}{}  ", ago(f.last_at())), dim());
    let number = Span::styled(format!("{:>2}  ", f.h.code), dim());
    let room = width.saturating_sub(width_of(&[bar.clone(), number.clone(), when.clone()]) + 2);
    let name = Span::styled(cut(&f.name, room), if chosen { bold() } else { Style::default() });
    let mut top = vec![bar.clone(), number, name];
    let gap = width.saturating_sub(width_of(&top) + when.content.width());
    top.push(Span::raw(" ".repeat(gap)));
    top.push(when);
    // who's in it, each with what they're doing
    let indent = "      ";
    let mut who = vec![bar.clone(), Span::raw(&indent[2..])];
    let members: Vec<&Member> = f.crew.active().collect();
    if members.is_empty() {
        who.push(Span::styled("nobody yet", dim()));
    }
    for (i, m) in members.iter().enumerate() {
        if i > 0 {
            who.push(Span::raw("   "));
        }
        let state = f.state(m);
        who.push(logo(&m.agent));
        who.push(Span::raw(format!(" {} ", member_label(m))));
        if busy(&state) {
            who.push(Span::styled(format!("{s} {state}"), Style::default().fg(color(&m.agent))));
        } else {
            who.push(Span::styled(state, dim()));
        }
    }
    let mut who_line: Vec<Span<'static>> = vec![];
    let mut used = 0;
    for sp in who {
        let w = sp.content.width();
        if used + w > width.saturating_sub(1) {
            let left = width.saturating_sub(used + 1);
            if left > 1 {
                who_line.push(Span::styled(cut(&sp.content, left), sp.style));
            }
            break;
        }
        used += w;
        who_line.push(sp);
    }
    // the last thing said
    let room = width.saturating_sub(indent.width() + 2);
    let said = match last_said(f) {
        Some((by, text)) => {
            let by = format!("{by}: ");
            vec![bar.clone(), Span::raw(&indent[2..]), Span::styled(by.clone(), dim()), Span::styled(cut(&text, room.saturating_sub(by.width())), dim())]
        }
        None => vec![bar.clone(), Span::raw(&indent[2..]), Span::styled("Nothing said yet", dim())],
    };
    // the same height whether chosen or not, so moving the highlight never shifts the list: a padding line above
    // and below, shaded only on the chosen card
    vec![fill(vec![bar.clone()]), fill(top), fill(who_line), fill(said), fill(vec![bar])]
}

/// Which huddle to watch: every running one, latest first, as a card each.
fn picker(frame: &mut Frame, app: &mut App) {
    let area = frame.area();
    let s = spin(app);
    let [_, top, _, list, foot, _] = Layout::vertical([
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Min(1),
        Constraint::Length(1),
        Constraint::Length(1),
    ])
    .areas(area);
    let full = inset(area).width as usize;
    let running = app.feeds.len();
    let count = match running {
        0 => String::new(),
        1 => "1 running".into(),
        n => format!("{n} running"),
    };
    // everything sits in a column in the middle, the way Grok centres its content
    let width = full.min(104);
    let column = Rect { x: list.x + (list.width.saturating_sub(width as u16)) / 2, width: width as u16, ..list };
    frame.render_widget(
        Paragraph::new(spread(vec![Span::styled("huddle ", dim()), Span::raw("watch")], vec![Span::styled(count, dim())], width)),
        Rect { x: column.x, width: column.width, ..top },
    );
    let mut lines: Vec<Line> = vec![];
    if running == 0 {
        lines.push(Line::default());
        lines.push(Line::styled("No huddles running yet", bold()));
        lines.push(Line::default());
        lines.push(Line::styled("This screen updates by itself. Ask Claude or Codex to bring in the other one", dim()));
        lines.push(Line::styled("(\"get Codex to review this\"), or type /huddle in Claude Code and $huddle in Codex.", dim()));
        frame.render_widget(Paragraph::new(lines), column);
    } else {
        app.choice = app.choice.min(running - 1);
        lines.push(Line::default());
        lines.push(Line::styled("Which huddle do you want to watch?", bold()));
        lines.push(Line::styled("Latest first. Esc in a huddle brings you back here.", dim()));
        lines.push(Line::default());
        let head = lines.len();
        let order = app.picker_order();
        let mut cards: Vec<Vec<Line<'static>>> = vec![];
        for (at, i) in order.iter().enumerate() {
            cards.push(huddle_card(&app.feeds[*i], at == app.choice, &app.here, width, s));
        }
        // scroll so the chosen card is always on screen
        let room = (column.height as usize).saturating_sub(head);
        let mut first = 0;
        while first < app.choice && cards[first..=app.choice].iter().map(|c| c.len()).sum::<usize>() > room {
            first += 1;
        }
        if first > 0 {
            lines.push(Line::styled(format!("  ↑ {first} more"), dim()));
        }
        let mut used = 0;
        for (k, card) in cards.iter().enumerate().skip(first) {
            if used + card.len() > room.saturating_sub(1) && k > app.choice {
                lines.push(Line::styled(format!("  ↓ {} more", cards.len() - k), dim()));
                break;
            }
            used += card.len();
            lines.extend(card.iter().cloned());
        }
        frame.render_widget(Paragraph::new(lines), column);
    }
    let mut pairs = vec![("↑↓", "choose"), ("Enter", "watch")];
    if running > 1 {
        pairs.push(("1-9", "by number"));
    }
    if app.feed().is_some() {
        pairs.push(("Esc", "back"));
    }
    pairs.push(("^D", "quit"));
    let line = footer_line(app, if running > 0 { &pairs } else { &[("^D", "quit")] });
    frame.render_widget(Paragraph::new(line), Rect { x: column.x, width: column.width, ..foot });
}

/// What each member is doing, packed into as few rows as fit.
fn status(f: &Feed, width: usize, s: &str, skip: &[String]) -> Vec<Line<'static>> {
    if f.ended {
        return vec![Line::styled("This huddle has ended.  esc for the others  ·  ctrl+d quit", dim())];
    }
    if f.h.joined_at.is_none() {
        let hint = if f.h.opener == "claude" { "In Codex: $huddle" } else { "In Claude Code: /huddle" };
        return vec![Line::styled(format!("Waiting for the other agent. {hint}"), dim())];
    }
    let mut rows: Vec<Line<'static>> = vec![];
    let mut row: Vec<Span<'static>> = vec![];
    for m in f.crew.active().filter(|m| !skip.contains(&m.name)) {
        let mut text = f.state(m);
        if !busy(&text) && !f.hears(m) {
            text = "not listening".into();
        }
        if busy(&text) {
            // only how long: what it's doing shows in the conversation, where it happens
            text = text.split(" · ").next().unwrap_or("").to_string();
        }
        let state = if busy(&text) {
            Span::styled(format!(" {s} {text}"), Style::default().fg(color(&m.agent)))
        } else if text == "not listening" {
            Span::styled(format!(" {text}"), Style::default().fg(AMBER))
        } else {
            Span::styled(format!(" {text}"), dim())
        };
        let piece = vec![logo(&m.agent), Span::raw(" "), Span::raw(member_label(m)), state];
        if !row.is_empty() && width_of(&row) + 5 + width_of(&piece) > width {
            rows.push(Line::from(std::mem::take(&mut row)));
        }
        if !row.is_empty() {
            row.push(Span::styled("  ·  ", dim()));
        }
        row.extend(piece);
    }
    if !row.is_empty() {
        rows.push(Line::from(row));
    }
    rows
}

/// What's typed, as the lines the input box shows, wrapped by display width.
fn typed_lines(text: &str, width: usize) -> Vec<String> {
    let width = width.max(10);
    let mut out = vec![];
    for para in text.split('\n') {
        let mut line = String::new();
        for ch in para.chars() {
            if line.width() + ch.to_string().width() > width {
                out.push(std::mem::take(&mut line));
            }
            line.push(ch);
        }
        out.push(line);
    }
    out
}

fn chat(frame: &mut Frame, app: &mut App) {
    let area = frame.area();
    let s = spin(app);
    let ids: Vec<i64> = app.feeds.iter().map(|f| f.h.id).collect();
    let current = app.current;
    let typed = app.typed.clone();
    let notice = app.notice.clone();
    let Some(f) = app.feeds.iter_mut().find(|f| Some(f.h.id) == current) else { return };
    let name = f.name.clone();
    let full = inset(area).width as usize;

    // the input box. Its prompt is who the message goes to ("✻ Claude ›", ">_ reviewer ›", "everyone ›"), in that
    // agent's colour, and the border takes the colour too: you can't type without seeing who it's for.
    if f.to.as_ref().map(|t| t != crate::app::EVERYONE && !f.crew.names().contains(t)).unwrap_or(false) {
        f.to = None;
    }
    let zoom_now = app_zoom(current, f);
    let target = zoom_now.clone().or_else(|| f.target()); // zoomed in, you talk to that agent
    let member = target.as_ref().and_then(|t| f.crew.by_name(t)).cloned();
    // inside the box, just the app; the line under it says exactly which member
    let mut prompt: Vec<Span<'static>> = match &member {
        Some(m) => vec![
            logo(&m.agent),
            Span::raw(" "),
            Span::styled(crate::app::app_name(&m.agent).to_string(), Style::default().fg(color(&m.agent)).add_modifier(Modifier::BOLD)),
        ],
        None => vec![Span::styled(if f.crew.names().len() == 2 { "both" } else { "everyone" }, bold())],
    };
    let mut guide: Vec<Span<'static>> = vec![Span::styled("messaging ", dim())];
    match &member {
        Some(m) if m.helper => {
            guide.push(Span::styled(m.name.clone(), Style::default().fg(color(&m.agent))));
            guide.push(Span::styled(format!(", a {} helper", crate::app::app_name(&m.agent)), dim()));
        }
        Some(m) => guide.push(Span::styled(member_label(m), Style::default().fg(color(&m.agent)))),
        None => {
            let names: Vec<String> = f.crew.active().map(member_label).collect();
            guide.push(Span::raw(if names.len() == 2 { "both" } else { "everyone" }));
            guide.push(Span::styled(format!(": {}", names.join(", ")), dim()));
        }
    }
    prompt.push(Span::styled(" › ", dim()));
    let border = Color::Indexed(240); // neutral: the prompt and the line under the box say who
    // a thread that's working will listen again when its turn ends; only an idle one with no wait is deaf
    let deaf = member.as_ref().map(|m| !f.hears(m) && !busy(&f.state(m))).unwrap_or(false);
    if deaf {
        guide.push(Span::styled(", not listening: it sees this when it next checks", Style::default().fg(AMBER)));
    }
    // a working agent takes a message when its turn ends; a working Codex helper can take it now
    let target_busy = member.as_ref().map(|m| busy(&f.state(m))).unwrap_or(false);
    let steerable = member.as_ref().map(|m| m.helper && m.agent == "codex").unwrap_or(false) && target_busy;
    if target_busy {
        guide.push(Span::styled("  ·  ", dim()));
        guide.push(Span::raw("enter"));
        guide.push(Span::styled(" queue", dim()));
        if steerable {
            guide.push(Span::styled("  ·  ", dim()));
            guide.push(Span::raw("ctrl+enter"));
            guide.push(Span::styled(" steer now", dim()));
        }
    }
    // esc: back to every huddle, to switch (from an agent's live view, esc first leaves that)
    let huddles = if zoom_now.is_some() { ("esc", "back") } else { ("esc", "huddles") };
    let keys: Vec<(&str, &str)> = if target_busy {
        vec![("tab", "switch"), ("ctrl+o", "agents"), huddles]
    } else {
        vec![("tab", "switch"), ("ctrl+o", "agents"), huddles, ("?", "all keys")]
    };
    for &(key, what) in &keys {
        guide.push(Span::styled("  ·  ", dim()));
        guide.push(Span::raw(key));
        guide.push(Span::styled(format!(" {what}"), dim()));
    }
    let lead = width_of(&prompt);
    let inner = full.saturating_sub(4 + lead);
    let text_lines = if typed.is_empty() { vec![String::new()] } else { typed_lines(&typed, inner) };
    let shown_lines: Vec<String> = text_lines.iter().rev().take(6).rev().cloned().collect();
    let mut input: Vec<Line> = vec![];
    for (i, t) in shown_lines.iter().enumerate() {
        let mut spans = if i == 0 { prompt.clone() } else { vec![Span::raw(" ".repeat(lead))] };
        if typed.is_empty() {
            spans.push(Span::styled("Type a message", dim()));
        } else {
            spans.push(Span::raw(t.clone()));
        }
        input.push(Line::from(spans));
    }

    let zoom = app_zoom(current, f);
    let state = status(f, full, s, &[]);
    // what you sent that a working agent hasn't taken yet, the way Claude Code lists queued messages over its input
    let mut queued: Vec<Line<'static>> = vec![];
    let waiting: Vec<&Message> = f
        .items
        .iter()
        .filter(|m| m.sender == "you" && !f.seen(m))
        .filter(|m| m.recipient.as_ref().and_then(|r| f.crew.by_name(r)).map(|x| busy(&f.state(x))).unwrap_or(false))
        .collect();
    for m in waiting.iter().rev().take(3).rev() {
        let to = f.crew.label(m.recipient.as_deref().unwrap_or(""));
        let (mark, style) = if m.steer { ("steering", Style::default().fg(GREEN)) } else { ("queued", Style::default().fg(AMBER)) };
        let lead = format!("  {mark} → {to}  ");
        let text = cut(&m.text.split_whitespace().collect::<Vec<_>>().join(" "), full.saturating_sub(lead.width() + 2));
        queued.push(Line::from(vec![Span::styled(format!("  {mark}"), style), Span::styled(format!(" → {to}  "), dim()), Span::raw(text)]));
    }
    if waiting.len() > 3 {
        queued.push(Line::styled(format!("  +{} more queued", waiting.len() - 3), dim()));
    }
    let [_, top, _, body, _, waits, stat, boxed, foot, _] = Layout::vertical([
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Min(1),
        Constraint::Length(1),
        Constraint::Length(queued.len() as u16),
        Constraint::Length(state.len() as u16),
        Constraint::Length(input.len() as u16 + 2),
        Constraint::Length(1),
        Constraint::Length(1),
    ])
    .areas(area);

    // the header: where, and what's going on
    let working = f.crew.active().filter(|m| busy(&f.state(m))).count();
    let mut right = vec![Span::raw(if working > 0 { format!("{working} working") } else { "all idle".into() })];
    if ids.len() > 1 {
        let place = ids.iter().position(|id| Some(*id) == current).map(|i| i + 1).unwrap_or(1);
        right.push(Span::styled("  │  ", dim()));
        right.push(Span::styled(format!("[{place} of {} · ^N]", ids.len()), dim()));
    }
    let mut left = vec![Span::styled(format!("{} ", repo_name(&f.h.repo)), dim()), Span::raw(name)];
    if f.ended {
        left.push(Span::styled("  ended", dim()));
    }
    frame.render_widget(Paragraph::new(spread(left, right, full)), inset(top));

    let talk = inset(body);
    let height = talk.height as usize;
    let width = (talk.width as usize).saturating_sub(2);
    if help_open() {
        frame.render_widget(Paragraph::new(help_lines()), talk);
    } else if agents_open() {
        let rows = agent_rows_now();
        let lines = agent_list(f, &rows, agent_choice_now(), width, s);
        let mut shown = lines;
        shown.truncate(height);
        frame.render_widget(Paragraph::new(shown), talk);
    } else {
    let mut pins: Vec<(usize, String)> = vec![];
    let (lines, scroll, unseen) = match &zoom {
        // one agent's every step, full screen
        Some(who) => {
            let mut cache = std::mem::take(&mut f.traced);
            let lines = zoom_lines(f, who, width, s, &mut pins, &mut cache);
            f.traced = cache;
            let scroll = zoom_scroll(who, lines.len(), height);
            (lines, scroll, 0)
        }
        // the conversation, with each agent's work shown under the message that asked for it
        None => {
            let lines = conversation(f, width, s, &mut pins);
            if f.scroll > 0 {
                f.scroll += lines.len().saturating_sub(f.drawn_total); // scrolled up: stay on the same lines
            }
            f.drawn_total = lines.len();
            f.scroll = f.scroll.min(lines.len().saturating_sub(height));
            (lines, f.scroll, f.unseen)
        }
    };
    let total = lines.len();
    let end = total - scroll;
    let start = end.saturating_sub(height);
    show(frame, talk, lines[start..end].to_vec(), height, scroll, unseen, total, start);
    // Scrolled up, as Claude Code does: the prompt the lines at the top answer, pinned there once it's out of view
    // (its first line gone). Following the newest lines, nothing is pinned.
    if scroll > 0 {
        if let Some((_, text)) = pins.iter().rev().find(|(at, _)| *at < start) {
            let line = if zoom.is_some() {
                Line::styled(cut(&format!("── {text} "), width) + &"─".repeat(width.saturating_sub(text.width() + 4)), dim())
            } else {
                let shade = Style::default().bg(SHADE);
                let body = cut(text, width.saturating_sub(6));
                let pad = " ".repeat(width.saturating_sub(body.width() + 4));
                Line::from(vec![Span::styled("  ❯ ", bold().patch(shade)), Span::styled(body + &pad, dim().patch(shade))])
            };
            frame.render_widget(Paragraph::new(line), Rect { height: 1, width: talk.width.saturating_sub(2), ..talk });
        }
    }
    }

    // what's waiting for a working agent, then who's doing what
    frame.render_widget(Paragraph::new(queued), inset(waits));
    frame.render_widget(Paragraph::new(state), inset(stat));

    // the input
    let boxed = inset(boxed);
    frame.render_widget(
        Paragraph::new(input).block(
            Block::bordered().border_type(BorderType::Rounded).border_style(Style::default().fg(border)).padding(Padding::horizontal(1)),
        ),
        boxed,
    );
    let last = shown_lines.len().saturating_sub(1);
    let col = 2 + lead + if typed.is_empty() { 0 } else { shown_lines[last].width() };
    frame.set_cursor_position(Position { x: boxed.x + (col as u16).min(boxed.width.saturating_sub(2)), y: boxed.y + 1 + last as u16 });

    // under the box: who exactly gets what you type, or a notice when there is one
    let under = match notice {
        Some((text, _, _)) => Line::styled(text, Style::default().fg(AMBER)),
        None => Line::from(guide),
    };
    let foot = inset(foot);
    frame.render_widget(Paragraph::new(under), Rect { x: foot.x + 1, width: foot.width.saturating_sub(1), ..foot });
    app.page = height.saturating_sub(2).max(1);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bg_of(line: &Line, text: &str) -> Option<Color> {
        line.spans.iter().find(|s| s.content.contains(text)).and_then(|s| s.style.bg)
    }

    #[test]
    fn a_diff_shows_lines_and_changed_words_as_claude_code_does() {
        let text = "--- src/app.rs\n@@ -10,3 +10,3 @@\n fn keep() {}\n-let retries = 3;\n+let retries = 5;\n fn after() {}";
        let lines = diff(text, 60, 40);
        assert_eq!(lines.len(), 4);
        let gone = &lines[1];
        let came = &lines[2];
        assert_eq!(bg_of(gone, "let retries"), Some(REMOVED));
        assert_eq!(bg_of(gone, "3"), Some(REMOVED_WORD), "the word that changed, brighter");
        assert_eq!(bg_of(came, "5"), Some(ADDED_WORD));
        assert_eq!(bg_of(came, "   11 "), Some(ADDED), "the line number sits on the line's colour");
        assert_eq!(came.width(), 60, "the colour runs right across");
        assert_eq!(bg_of(&lines[0], "fn keep"), None, "unchanged lines stay plain");
    }

    #[test]
    fn a_long_line_wraps_between_words_with_its_sign_on_every_row() {
        let text = "@@ -13,1 +13,1 @@\n-one two three four five six seven eight nine ten\n+one two three four five six seven eight nine eleven";
        let lines = diff(text, 30, 40);
        let rows: Vec<String> = lines.iter().map(|l| l.spans.iter().map(|s| s.content.to_string()).collect::<String>()).collect();
        assert!(rows[0].starts_with("    13 -one two"), "{rows:?}");
        assert!(rows.iter().filter(|r| r.trim_start().starts_with('-')).count() >= 2, "every row of the removed line has its sign: {rows:?}");
        assert!(rows.iter().all(|r| !r.contains("thr ee")), "no word broken across rows: {rows:?}");
        assert_eq!(lines[0].spans[0].style.fg, Some(REMOVED_NUMBER));
        assert!(lines.iter().any(|l| l.spans.iter().any(|s| s.content.contains("eleven") && s.style.bg == Some(ADDED_WORD))));
    }

    #[test]
    fn a_new_file_is_all_added() {
        let lines = diff("--- notes.md\nfirst\nsecond", 40, 40);
        assert_eq!(lines.len(), 2);
        assert_eq!(bg_of(&lines[1], "second"), Some(ADDED));
        assert!(lines[1].spans[0].content.contains('2'));
    }
}
