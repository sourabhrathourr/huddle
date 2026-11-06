//! Everything the watch reads from disk, done on its own thread: the database, and the apps' session files
//! (which can mean megabytes). The drawing thread only takes keys and draws, so typing never waits on a read.

use crate::app::Crew;
use crate::db::{self, Huddle, Message, Step};
use crate::sessions::{self, Direct, Paths, Transcripts};
use std::collections::HashMap;
use std::sync::mpsc::{sync_channel, Receiver};
use std::time::{Duration, Instant};

/// One huddle's news since the last update.
pub struct Update {
    pub h: Huddle,
    pub crew: Crew,
    pub items: Vec<Message>,
    /// Steps helpers took, new or changed since the last update.
    pub steps: Vec<Step>,
    /// When each thread the user opened started its current turn (None: idle). Only when re-checked.
    pub acts: Option<HashMap<String, Option<f64>>>,
    /// The huddle's name as the user knows it. Only when re-checked.
    pub name: Option<String>,
    /// The title of each thread the user opened, by member name. Only when re-checked.
    pub titles: Option<HashMap<String, String>>,
    /// Claude Code threads with a `huddle wait` running: the ones that hear what's sent to them. Only when re-checked.
    pub listening: Option<Vec<String>>,
    /// How far each member has read.
    pub reads: Vec<(String, i64)>,
    pub ended: bool,
}

struct Tracked {
    seen: i64,
    steps_at: f64,
    /// Each step's last change already sent: the `updated >=` read sees the newest again every time.
    sent: HashMap<i64, f64>,
    direct: HashMap<String, Direct>,
    acts_at: Option<Instant>,
    name_at: Option<Instant>,
}

pub fn spawn(paths: Paths) -> Receiver<Vec<Update>> {
    // a short queue: while the watch is away (an agent's session open in its place) the loader waits, instead
    // of piling up updates nobody reads
    let (tx, rx) = sync_channel(2);
    std::thread::spawn(move || {
        let Ok(conn) = db::open(&paths.huddle_db) else { return };
        let mut transcripts = Transcripts::default();
        let mut tracked: HashMap<i64, Tracked> = HashMap::new();
        loop {
            let mut ids: Vec<i64> = db::live(&conn).into_iter().map(|h| h.id).collect();
            ids.extend(tracked.keys().filter(|id| !ids.contains(id)).copied().collect::<Vec<_>>());
            let mut batch = vec![];
            for id in ids {
                let t = tracked.entry(id).or_insert(Tracked { seen: 0, steps_at: 0.0, sent: HashMap::new(), direct: HashMap::new(), acts_at: None, name_at: None });
                let Some(h) = db::huddle(&conn, id) else {
                    tracked.remove(&id);
                    continue;
                };
                let crew = Crew { all: db::members(&conn, id) };
                let new = db::messages_after(&conn, id, t.seen);
                if let Some(last) = new.last() {
                    t.seen = last.id;
                }
                // threads that left (a member rejoined from a new thread) aren't read any more
                let seated: Vec<String> = crew.active().filter(|m| !m.helper).filter_map(|m| m.thread.clone()).collect();
                t.direct.retain(|thread, _| seated.contains(thread));
                for m in crew.active() {
                    if let (false, Some(thread)) = (m.helper, &m.thread) {
                        // a helper's answers are already huddle messages
                        t.direct.entry(thread.clone()).or_insert_with(|| Direct::new(&m.agent, thread, &m.name, h.opened_at));
                    }
                }
                let sent = &mut t.sent;
                let steps: Vec<_> = db::steps_since(&conn, id, t.steps_at)
                    .into_iter()
                    .filter(|st| sent.insert(st.id, st.updated) != Some(st.updated))
                    .collect();
                if let Some(latest) = steps.iter().map(|s| s.updated).reduce(f64::max) {
                    t.steps_at = latest;
                }
                let mut items = new;
                let mut steps = steps;
                for d in t.direct.values_mut() {
                    items.extend(d.read(&paths, &mut transcripts));
                    steps.extend(d.take_steps());
                }
                items.sort_by(|a, b| a.sent_at.partial_cmp(&b.sent_at).unwrap_or(std::cmp::Ordering::Equal));
                let due = |at: Option<Instant>, secs: u64| at.map(|a| a.elapsed() >= Duration::from_secs(secs)).unwrap_or(true);
                let acts = due(t.acts_at, 1).then(|| {
                    t.acts_at = Some(Instant::now());
                    crew.active()
                        .filter(|m| !m.helper)
                        .filter_map(|m| m.thread.clone().map(|th| (th.clone(), sessions::activity(&paths, &mut transcripts, &m.agent, &th))))
                        .collect()
                });
                let name = due(t.name_at, 15).then(|| {
                    t.name_at = Some(Instant::now());
                    let first = crew.active().find(|m| !m.helper).cloned();
                    h.topic
                        .clone()
                        .filter(|t| !t.is_empty())
                        .or_else(|| first.and_then(|m| m.thread.and_then(|th| sessions::thread_label(&paths, &mut transcripts, &m.agent, &th))))
                        .unwrap_or_else(|| format!("Huddle {}", h.code))
                });
                let titles = name.as_ref().map(|_| {
                    crew.active()
                        .filter(|m| !m.helper)
                        .filter_map(|m| {
                            let th = m.thread.clone()?;
                            sessions::thread_label(&paths, &mut transcripts, &m.agent, &th).map(|t| (m.name.clone(), t))
                        })
                        .collect()
                });
                let listening = acts.as_ref().map(|_| {
                    db::waits(&conn, id).into_iter().filter(|(_, pid)| pid.map(db::alive).unwrap_or(false)).map(|(n, _)| n).collect()
                });
                let ended = !db::is_live(&h);
                if ended {
                    tracked.remove(&id); // one last update says so; after that it's the screen's to drop
                }
                let reads = db::reads(&conn, id);
                batch.push(Update { h, crew, items, steps, acts, name, titles, listening, reads, ended });
            }
            if tx.send(batch).is_err() {
                return; // the watch has quit
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    });
    rx
}
