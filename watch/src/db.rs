//! Reading huddle's SQLite file. The watch never writes to it: sending goes through the `huddle` command.

use rusqlite::{Connection, OpenFlags, Row};
use std::path::Path;
use std::time::Duration;

pub const INVITE_TTL: f64 = 15.0 * 60.0;
pub const IDLE_TTL: f64 = 24.0 * 3600.0;
/// The schema this watch understands: huddle 0.2.0's members, replies, helpers and their steps.
pub const SCHEMA: i64 = 10;

#[derive(Clone, Debug)]
pub struct Huddle {
    pub id: i64,
    pub code: String,
    pub repo: String,
    pub topic: Option<String>,
    pub opener: String,
    pub opened_at: f64,
    pub joined_at: Option<f64>,
    pub last_at: f64,
    pub ended_at: Option<f64>,
}

#[derive(Clone, Debug)]
pub struct Member {
    pub id: i64,
    pub parent: Option<i64>,
    pub name: String,
    pub agent: String,
    pub thread: Option<String>,
    pub helper: bool,
    pub left_at: Option<f64>,
    pub state: Option<String>,
    pub activity: Option<String>,
    pub since: Option<f64>,
    /// A Codex helper on Codex's shared server: its session opens in Codex alongside, even while it works.
    pub shared: bool,
}

#[derive(Clone, Debug)]
pub struct Message {
    pub id: i64,
    pub sender: String,
    pub recipient: Option<String>,
    pub text: String,
    pub sent_at: f64,
    pub reply_to: Option<i64>,
    /// The user sent it to join the turn its recipient is on now.
    pub steer: bool,
}

/// One thing a helper did in a turn: thought, said, ran, edited, read, searched.
#[derive(Clone, Debug)]
pub struct Step {
    pub id: i64,
    pub member: String,
    pub turn: Option<i64>,
    pub kind: String,
    pub title: String,
    pub detail: Option<String>,
    pub status: Option<String>,
    /// When it started, and when it last changed.
    pub at: f64,
    pub updated: f64,
}

/// Steps added or changed since `after` (an `updated` time), oldest first.
pub fn steps_since(conn: &Connection, huddle_id: i64, after: f64) -> Vec<Step> {
    let mut stmt = match conn.prepare("SELECT * FROM steps WHERE huddle_id = ?1 AND updated >= ?2 ORDER BY id") {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map(rusqlite::params![huddle_id, after], |r| {
        Ok(Step {
            id: r.get("id")?,
            member: r.get("member")?,
            turn: r.get("turn")?,
            kind: r.get("kind")?,
            title: r.get("title")?,
            detail: r.get("detail")?,
            status: r.get("status")?,
            at: r.get("at")?,
            updated: r.get("updated")?,
        })
    })
    .map(|rows| rows.filter_map(Result::ok).collect())
    .unwrap_or_default()
}

/// Members of a huddle with a `huddle wait` recorded, and that wait's process.
pub fn waits(conn: &Connection, huddle_id: i64) -> Vec<(String, Option<i64>)> {
    let mut stmt = match conn.prepare(
        "SELECT m.name, w.pid FROM waits w JOIN members m ON m.id = w.member WHERE m.huddle_id = ?1 AND m.left_at IS NULL",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map([huddle_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default()
}

/// Whether a process is still running.
pub fn alive(pid: i64) -> bool {
    std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// How far each member of a huddle has read: the id of the last message it took in.
pub fn reads(conn: &Connection, huddle_id: i64) -> Vec<(String, i64)> {
    let mut stmt = match conn.prepare(
        "SELECT m.name, r.last_id FROM reads r JOIN members m ON m.id = r.member WHERE m.huddle_id = ?1 AND m.left_at IS NULL",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map([huddle_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default()
}

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
    conn.busy_timeout(Duration::from_secs(10))?;
    Ok(conn)
}

pub fn schema(conn: &Connection) -> i64 {
    conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap_or(0)
}

pub fn now() -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

fn huddle_row(r: &Row) -> rusqlite::Result<Huddle> {
    Ok(Huddle {
        id: r.get("id")?,
        code: r.get("code")?,
        repo: r.get("repo")?,
        topic: r.get("topic")?,
        opener: r.get("opener")?,
        opened_at: r.get("opened_at")?,
        joined_at: r.get("joined_at")?,
        last_at: r.get("last_at")?,
        ended_at: r.get("ended_at")?,
    })
}

/// Not ended, and either a fresh invite or a joined huddle that's still in use. Matches `live()` in huddle.
pub fn is_live(h: &Huddle) -> bool {
    if h.ended_at.is_some() {
        return false;
    }
    let t = now();
    match h.joined_at {
        Some(_) => h.last_at > t - IDLE_TTL,
        None => h.opened_at > t - INVITE_TTL,
    }
}

/// Running huddles, oldest first.
pub fn live(conn: &Connection) -> Vec<Huddle> {
    let t = now();
    let mut stmt = match conn.prepare(
        "SELECT * FROM huddles WHERE ended_at IS NULL AND ((joined_at IS NULL AND opened_at > ?1) \
         OR (joined_at IS NOT NULL AND last_at > ?2)) ORDER BY opened_at",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map([t - INVITE_TTL, t - IDLE_TTL], huddle_row)
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default()
}

pub fn huddle(conn: &Connection, id: i64) -> Option<Huddle> {
    conn.query_row("SELECT * FROM huddles WHERE id = ?1", [id], huddle_row).ok()
}

/// Everyone who has been in the huddle, in the order they arrived, including members who left.
pub fn members(conn: &Connection, huddle_id: i64) -> Vec<Member> {
    let mut stmt = match conn.prepare("SELECT * FROM members WHERE huddle_id = ?1 ORDER BY id") {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map([huddle_id], |r| {
        Ok(Member {
            id: r.get("id")?,
            parent: r.get("parent")?,
            name: r.get("name")?,
            agent: r.get("agent")?,
            thread: r.get("thread")?,
            helper: r.get::<_, i64>("helper")? != 0,
            left_at: r.get("left_at")?,
            state: r.get("state")?,
            activity: r.get("activity")?,
            since: r.get("since")?,
            shared: r.get::<_, Option<i64>>("shared")?.unwrap_or(0) != 0,
        })
    })
    .map(|rows| rows.filter_map(Result::ok).collect())
    .unwrap_or_default()
}

pub fn messages_after(conn: &Connection, huddle_id: i64, seen: i64) -> Vec<Message> {
    let mut stmt = match conn.prepare("SELECT * FROM messages WHERE huddle_id = ?1 AND id > ?2 ORDER BY id") {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map([huddle_id, seen], |r| {
        Ok(Message {
            id: r.get("id")?,
            sender: r.get("sender")?,
            recipient: r.get("recipient")?,
            text: r.get("text")?,
            sent_at: r.get("sent_at")?,
            reply_to: r.get("reply_to")?,
            steer: r.get::<_, Option<i64>>("steer")?.unwrap_or(0) != 0,
        })
    })
    .map(|rows| rows.filter_map(Result::ok).collect())
    .unwrap_or_default()
}
