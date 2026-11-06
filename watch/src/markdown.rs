//! Agent messages are Markdown. This turns one into styled lines wrapped to a width: headings and **bold** in
//! bold, `code` in a warm tint, code blocks dimmed and unwrapped, lists with bullets, quotes with a bar, and
//! tables as aligned columns (or one row per line when they don't fit).

use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use unicode_width::UnicodeWidthStr;

pub const CODE: Color = Color::Indexed(73); // teal, as Grok shows code and paths

type Piece = (String, Style);

#[derive(Default)]
struct Writer {
    out: Vec<Line<'static>>,
    pending: Vec<Piece>,
    style: Vec<Style>,
    lists: Vec<Option<u64>>,
    marker: Option<String>,
    quote: usize,
    code: bool,
    table: Option<Table>,
    width: usize,
}

#[derive(Default)]
struct Table {
    rows: Vec<Vec<String>>,
    head: usize,
    cell: Option<String>,
}

pub fn render(text: &str, width: usize) -> Vec<Line<'static>> {
    let width = width.max(20);
    let mut w = Writer { width, ..Default::default() };
    let options = Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS;
    for event in Parser::new_ext(text, options) {
        w.event(event);
    }
    w.flush();
    while w.out.last().map(|l| l.width() == 0).unwrap_or(false) {
        w.out.pop();
    }
    w.out
}

impl Writer {
    fn current(&self) -> Style {
        self.style.last().copied().unwrap_or_default()
    }

    fn push_style(&mut self, f: impl Fn(Style) -> Style) {
        let s = f(self.current());
        self.style.push(s);
    }

    fn blank(&mut self) {
        if self.out.last().map(|l| l.width() > 0).unwrap_or(false) {
            self.out.push(Line::default());
        }
    }

    fn text(&mut self, t: &str) {
        if let Some(table) = self.table.as_mut() {
            if let Some(cell) = table.cell.as_mut() {
                cell.push_str(t);
            }
            return;
        }
        if self.code {
            let bar = self.bar();
            for line in t.trim_end_matches('\n').split('\n') {
                let mut spans = bar.clone();
                spans.push(Span::raw("  "));
                spans.push(Span::styled(line.to_string(), Style::default().add_modifier(Modifier::DIM)));
                self.out.push(Line::from(spans));
            }
            return;
        }
        let style = self.current();
        self.pending.push((t.to_string(), style));
    }

    /// The quote bars that lead every line inside a blockquote.
    fn bar(&self) -> Vec<Span<'static>> {
        (0..self.quote).map(|_| Span::styled("│ ", Style::default().add_modifier(Modifier::DIM))).collect()
    }

    fn event(&mut self, event: Event) {
        match event {
            Event::Start(tag) => match tag {
                Tag::Heading { .. } => self.push_style(|s| s.add_modifier(Modifier::BOLD)),
                Tag::Strong => self.push_style(|s| s.add_modifier(Modifier::BOLD)),
                Tag::Emphasis => self.push_style(|s| s.add_modifier(Modifier::ITALIC)),
                Tag::Strikethrough => self.push_style(|s| s.add_modifier(Modifier::CROSSED_OUT)),
                Tag::Link { .. } => self.push_style(|s| s.add_modifier(Modifier::UNDERLINED)),
                Tag::BlockQuote(_) => {
                    self.flush();
                    self.quote += 1;
                }
                Tag::CodeBlock(_) => {
                    self.flush();
                    self.code = true;
                }
                Tag::List(start) => {
                    self.flush();
                    self.lists.push(start);
                }
                Tag::Item => {
                    self.flush();
                    let depth = self.lists.len().saturating_sub(1);
                    let mark = match self.lists.last_mut() {
                        Some(Some(n)) => {
                            let m = format!("{n}. ");
                            *n += 1;
                            m
                        }
                        _ => "• ".to_string(),
                    };
                    self.marker = Some("  ".repeat(depth) + &mark);
                }
                Tag::Table(_) => {
                    self.flush();
                    self.table = Some(Table::default());
                }
                Tag::TableHead | Tag::TableRow => {
                    if let Some(t) = self.table.as_mut() {
                        t.rows.push(vec![]);
                    }
                }
                Tag::TableCell => {
                    if let Some(t) = self.table.as_mut() {
                        t.cell = Some(String::new());
                    }
                }
                _ => {}
            },
            Event::End(tag) => match tag {
                TagEnd::Paragraph => {
                    self.flush();
                    if self.lists.is_empty() {
                        self.blank();
                    }
                }
                TagEnd::Heading(_) => {
                    self.flush();
                    self.style.pop();
                    self.blank();
                }
                TagEnd::Strong | TagEnd::Emphasis | TagEnd::Strikethrough | TagEnd::Link => {
                    self.style.pop();
                }
                TagEnd::BlockQuote(_) => {
                    self.flush();
                    self.quote = self.quote.saturating_sub(1);
                    self.blank();
                }
                TagEnd::CodeBlock => {
                    self.code = false;
                    self.blank();
                }
                TagEnd::Item => self.flush(),
                TagEnd::List(_) => {
                    self.flush();
                    self.lists.pop();
                    if self.lists.is_empty() {
                        self.blank();
                    }
                }
                TagEnd::TableCell => {
                    if let Some(t) = self.table.as_mut() {
                        let cell = t.cell.take().unwrap_or_default();
                        if let Some(row) = t.rows.last_mut() {
                            row.push(cell.split_whitespace().collect::<Vec<_>>().join(" "));
                        }
                    }
                }
                TagEnd::TableHead => {
                    if let Some(t) = self.table.as_mut() {
                        t.head = t.rows.len();
                    }
                }
                TagEnd::Table => {
                    if let Some(t) = self.table.take() {
                        self.table(t);
                    }
                    self.blank();
                }
                _ => {}
            },
            Event::Text(t) => self.text(&t),
            Event::Code(t) => {
                if let Some(table) = self.table.as_mut() {
                    if let Some(cell) = table.cell.as_mut() {
                        cell.push_str(&t);
                    }
                } else {
                    let style = self.current().fg(CODE);
                    self.pending.push((t.to_string(), style));
                }
            }
            Event::SoftBreak => self.text(" "),
            Event::HardBreak => self.flush(),
            Event::Rule => {
                self.flush();
                self.out.push(Line::styled("─".repeat(self.width.min(40)), Style::default().add_modifier(Modifier::DIM)));
                self.blank();
            }
            Event::TaskListMarker(done) => self.text(if done { "[x] " } else { "[ ] " }),
            Event::Html(t) | Event::InlineHtml(t) => self.text(&t),
            _ => {}
        }
    }

    /// Wrap what's pending into lines, after the list marker or quote bar that leads them.
    fn flush(&mut self) {
        if self.pending.is_empty() {
            return;
        }
        let pieces = std::mem::take(&mut self.pending);
        let mut first: Vec<Span<'static>> = self.bar();
        let mut rest: Vec<Span<'static>> = self.bar();
        if let Some(mark) = self.marker.take() {
            let indent = " ".repeat(mark.width());
            first.push(Span::styled(mark, Style::default().add_modifier(Modifier::DIM)));
            rest.push(Span::raw(indent));
        } else if !self.lists.is_empty() {
            let indent = "  ".repeat(self.lists.len());
            first.push(Span::raw(indent.clone()));
            rest.push(Span::raw(indent));
        }
        self.out.extend(wrap(&pieces, self.width, first, rest));
    }

    fn table(&mut self, t: Table) {
        let cols = t.rows.iter().map(Vec::len).max().unwrap_or(0);
        let mut widths = vec![0usize; cols];
        for row in &t.rows {
            for (i, cell) in row.iter().enumerate() {
                widths[i] = widths[i].max(cell.width());
            }
        }
        let total: usize = widths.iter().sum::<usize>() + 3 * cols.saturating_sub(1);
        let bold = Style::default().add_modifier(Modifier::BOLD);
        let dim = Style::default().add_modifier(Modifier::DIM);
        if total <= self.width {
            for (r, row) in t.rows.iter().enumerate() {
                let mut spans = vec![];
                for (i, cell) in row.iter().enumerate() {
                    if i > 0 {
                        spans.push(Span::styled(" │ ", dim));
                    }
                    let pad = " ".repeat(widths[i].saturating_sub(cell.width()));
                    spans.push(Span::styled(format!("{cell}{pad}"), if r < t.head { bold } else { Style::default() }));
                }
                self.out.push(Line::from(spans));
                if r + 1 == t.head {
                    self.out.push(Line::styled("─".repeat(total), dim));
                }
            }
            return;
        }
        // Too wide: each row on its own, its cells separated by a dot, wrapped like text.
        for (r, row) in t.rows.iter().enumerate() {
            let style = if r < t.head { bold } else { Style::default() };
            let pieces: Vec<Piece> = vec![(row.join(" · "), style)];
            self.out.extend(wrap(&pieces, self.width, vec![Span::raw("• ")], vec![Span::raw("  ")]));
        }
    }
}

/// Greedy word wrap by display width. A word longer than a line is split.
pub fn wrap(pieces: &[Piece], width: usize, first: Vec<Span<'static>>, rest: Vec<Span<'static>>) -> Vec<Line<'static>> {
    let mut lines = vec![];
    let lead = |spans: &Vec<Span<'static>>| spans.iter().map(|s| s.content.width()).sum::<usize>();
    let mut line: Vec<Span<'static>> = first.clone();
    let mut used = lead(&first);
    let mut start = used;
    let mut space: Option<Style> = None;
    for (text, style) in pieces {
        let mut word = String::new();
        let mut chars = text.chars().peekable();
        loop {
            let c = chars.next();
            let boundary = matches!(c, None | Some(' '));
            if !boundary {
                word.push(c.unwrap());
                continue;
            }
            if !word.is_empty() {
                let w = word.width();
                let gap = if space.is_some() && used > start { 1 } else { 0 };
                if used + gap + w > width && used > start {
                    lines.push(Line::from(std::mem::replace(&mut line, rest.clone())));
                    used = lead(&rest);
                    start = used;
                } else if gap == 1 {
                    line.push(Span::styled(" ", space.unwrap()));
                    used += 1;
                }
                if w > width.saturating_sub(start) {
                    // too long for any line: split it where it must
                    let mut chunk = String::new();
                    for ch in word.chars() {
                        let cw = unicode_width::UnicodeWidthChar::width(ch).unwrap_or(0);
                        if used + chunk.width() + cw > width && (used > start || !chunk.is_empty()) {
                            line.push(Span::styled(std::mem::take(&mut chunk), *style));
                            lines.push(Line::from(std::mem::replace(&mut line, rest.clone())));
                            used = lead(&rest);
                            start = used;
                        }
                        chunk.push(ch);
                    }
                    used += chunk.width();
                    line.push(Span::styled(chunk, *style));
                } else {
                    used += w;
                    line.push(Span::styled(std::mem::take(&mut word), *style));
                }
                word.clear();
                space = None;
            }
            match c {
                Some(' ') => space = Some(*style),
                None => break,
                _ => {}
            }
        }
    }
    if used > start || lines.is_empty() {
        lines.push(Line::from(line));
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plain(lines: &[Line]) -> Vec<String> {
        lines.iter().map(|l| l.spans.iter().map(|s| s.content.as_ref()).collect()).collect()
    }

    #[test]
    fn paragraphs_lists_and_code() {
        let out = plain(&render("## Findings\n\n- **one** [file](/a/b.py)\n- two\n\n```\ncode\n```", 80));
        assert_eq!(out, vec!["Findings", "", "• one file", "• two", "", "  code"]);
    }

    #[test]
    fn wraps_by_width_and_keeps_words_whole() {
        let out = plain(&render("aaa bbb ccc ddd eee", 20));
        assert_eq!(out, vec!["aaa bbb ccc ddd eee"]);
        let out = plain(&render("alpha beta gamma delta epsilon zeta eta theta", 20));
        assert!(out.iter().all(|l| l.width() <= 20), "{out:?}");
        assert_eq!(out.join(" "), "alpha beta gamma delta epsilon zeta eta theta");
    }

    #[test]
    fn a_table_that_fits_is_aligned() {
        let out = plain(&render("| a | bb |\n|---|---|\n| ccc | d |", 80));
        assert_eq!(out[0], "a   │ bb");
        assert_eq!(out[2], "ccc │ d ");
    }
}
