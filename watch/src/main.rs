//! huddle-watch: the full-screen live view of huddle, built with ratatui.
//!
//!   huddle-watch [N]
//!
//! Shows one huddle at a time: every message between the user and their agents, what each agent and helper is
//! doing, and a line to message everyone or one of them. Ctrl-N and Ctrl-P switch huddles; Esc lists them all.
//! `huddle watch` starts it; it reads huddle's database and sends through the `huddle` command (HUDDLE_CLI).

mod app;
mod db;
mod loader;
mod markdown;
mod sessions;
mod ui;

use ratatui::crossterm::event::{
    self, DisableBracketedPaste, EnableBracketedPaste, KeyboardEnhancementFlags, PopKeyboardEnhancementFlags,
    PushKeyboardEnhancementFlags,
};
use ratatui::crossterm::style::Print;
use ratatui::crossterm::{execute, terminal};
use std::io::stdout;
use std::time::Duration;

fn main() {
    let code = std::env::args().nth(1).filter(|a| !a.starts_with('-'));
    if std::env::args().any(|a| a == "--version" || a == "-V") {
        println!("huddle-watch {}", env!("CARGO_PKG_VERSION"));
        return;
    }
    let paths = sessions::Paths::from_env();
    if !paths.huddle_db.exists() {
        eprintln!("No huddle history yet at {}. Run `huddle` once, then try again.", paths.huddle_db.display());
        std::process::exit(1);
    }
    match db::open(&paths.huddle_db) {
        Ok(conn) if db::schema(&conn) >= db::SCHEMA => {}
        Ok(_) => {
            eprintln!("This huddle history is from an older version. Run `huddle list` once to upgrade it, then try again.");
            std::process::exit(1);
        }
        Err(e) => {
            eprintln!("Couldn't open {}: {e}", paths.huddle_db.display());
            std::process::exit(1);
        }
    }
    let mut app = app::App::new(loader::spawn(paths), code);
    match run(&mut app) {
        Err(e) => {
            eprintln!("huddle-watch: {e}");
            std::process::exit(1);
        }
        Ok(Some(code)) => {
            // a new build of the watch: start it in this one's place, on the same huddle
            use std::os::unix::process::CommandExt;
            if let Ok(exe) = std::env::current_exe() {
                let err = std::process::Command::new(exe).args(code).exec();
                eprintln!("huddle-watch: couldn't restart: {err}");
                std::process::exit(1);
            }
        }
        Ok(None) => {}
    }
}

/// When the watch's own program file last changed: a newer build means it's time to restart into it.
fn built() -> Option<std::time::SystemTime> {
    std::fs::metadata(std::env::current_exe().ok()?).ok()?.modified().ok()
}

/// Runs until the user quits (None), or until a new build of the watch is installed: then it returns the huddle
/// to reopen in it.
fn run(app: &mut app::App) -> std::io::Result<Option<Option<String>>> {
    let started = built();
    let mut checked = std::time::Instant::now();
    let mut terminal = ratatui::init();
    // Shift+Enter for a new line where the terminal can tell it apart; pastes as one event; and the mouse wheel
    // sent as arrow keys, so the mouse stays the terminal's and selecting text still works.
    let enhanced = terminal::supports_keyboard_enhancement().unwrap_or(false);
    if enhanced {
        let _ = execute!(stdout(), PushKeyboardEnhancementFlags(KeyboardEnhancementFlags::DISAMBIGUATE_ESCAPE_CODES));
    }
    let _ = execute!(stdout(), EnableBracketedPaste, Print("\x1b[?1007h"));
    let result = (|| -> std::io::Result<Option<Option<String>>> {
        // Draw, then wait for a key for at most a tenth of a second (the spinner's step). Every key that's
        // waiting is handled before the next draw, so typing shows at once and a paste lands in one frame.
        // Nothing here reads from disk: the loader thread does, and refresh() only takes what it sent.
        loop {
            app.refresh();
            terminal.draw(|frame| ui::draw(frame, app))?;
            if event::poll(Duration::from_millis(100))? {
                loop {
                    let ev = event::read()?;
                    if let Ok(path) = std::env::var("HUDDLE_WATCH_KEYLOG") {
                        // for finding out what a terminal really sends
                        use std::io::Write;
                        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
                            let _ = writeln!(f, "{ev:?}");
                        }
                    }
                    if !app.handle(ev) {
                        return Ok(None);
                    }
                    if !event::poll(Duration::from_millis(0))? {
                        break;
                    }
                }
            }
            if checked.elapsed() >= Duration::from_secs(2) {
                checked = std::time::Instant::now();
                let now = built();
                // a new build, finished writing (wait out a build still in progress), and nothing half-typed to lose
                let settled = now.and_then(|t| t.elapsed().ok()).map(|age| age >= Duration::from_secs(2)).unwrap_or(false);
                if now.is_some() && now != started && app.typed.is_empty() && settled {
                    return Ok(Some(app.current_code()));
                }
            }
            if let Some((code, name)) = app.open.take() {
                // hand the terminal to the agent's own app, the way git hands it to an editor; take it back after
                let _ = execute!(stdout(), Print("\x1b[?1007l"), DisableBracketedPaste);
                if enhanced {
                    let _ = execute!(stdout(), PopKeyboardEnhancementFlags);
                }
                ratatui::restore();
                let cli = std::env::var("HUDDLE_CLI").unwrap_or_else(|_| "huddle".into());
                // its output goes straight to the terminal: it may be the agent's own app
                let status = std::process::Command::new(&cli).args(["show", &name, "-c", &code]).status();
                terminal = ratatui::init();
                if enhanced {
                    let _ = execute!(stdout(), PushKeyboardEnhancementFlags(KeyboardEnhancementFlags::DISAMBIGUATE_ESCAPE_CODES));
                }
                let _ = execute!(stdout(), EnableBracketedPaste, Print("\x1b[?1007h"));
                terminal.clear()?;
                match status {
                    Ok(s) if s.success() => {}
                    // no way to its window (5), or a helper at work (3): follow it here instead
                    Ok(s) if matches!(s.code(), Some(5) | Some(3)) => {
                        app.follow(&name);
                        if s.code() == Some(5) {
                            app.say("It's in a window of its own that the watch can't switch to here, so this is its live view.");
                        }
                    }
                    Ok(s) => app.say(format!("Couldn't open {name}'s session ({s}). `huddle show {name}` in a terminal says why.")),
                    Err(e) => app.say(format!("Couldn't run {cli}: {e}")),
                }
            }
        }
    })();
    let _ = execute!(stdout(), Print("\x1b[?1007l"), DisableBracketedPaste);
    if enhanced {
        let _ = execute!(stdout(), PopKeyboardEnhancementFlags);
    }
    ratatui::restore();
    result
}
