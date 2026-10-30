use chrono::{Datelike, NaiveDate, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

type Result<T> = std::result::Result<T, String>;
fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub date: String,
    pub title: String,
    pub short_label: Option<String>,
    pub description: Option<String>,
    pub completed: bool,
    pub priority: u8,
    pub category_id: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Category {
    pub id: String,
    pub name: String,
    pub color: String,
    pub is_builtin: bool,
    pub sort_order: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DayMark {
    pub date: String,
    pub kind: String,
    pub note: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub water_enabled: bool,
    #[serde(default = "default_water_goal")]
    pub water_goal: u32,
    pub active_view: String,
    pub background_opacity: f64,
    pub always_on_top: bool,
    pub animations_enabled: bool,
    pub show_holidays: bool,
    pub show_weekends: bool,
    pub opaque_fallback: bool,
    #[serde(default = "default_appearance")]
    pub appearance_mode: String,
    #[serde(default = "default_text_size")]
    pub text_size: String,
    #[serde(default = "default_header_layout")]
    pub header_layout: String,
    #[serde(default = "default_agenda_range")]
    pub agenda_range: String,
}
fn default_water_goal() -> u32 {
    2000
}
fn default_agenda_range() -> String {
    "rolling".into()
}
fn default_header_layout() -> String {
    "classic".into()
}
fn default_text_size() -> String {
    "standard".into()
}
fn default_appearance() -> String {
    "reading".into()
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            water_enabled: false,
            water_goal: default_water_goal(),
            active_view: "overview".into(),
            background_opacity: 0.85,
            always_on_top: false,
            animations_enabled: true,
            show_holidays: true,
            show_weekends: true,
            opaque_fallback: false,
            appearance_mode: default_appearance(),
            text_size: default_text_size(),
            header_layout: default_header_layout(),
            agenda_range: default_agenda_range(),
        }
    }
}
#[derive(Debug, Serialize, Deserialize)]
pub struct Snapshot {
    pub water_entries: Vec<WaterEntry>,
    pub tasks: Vec<Task>,
    pub categories: Vec<Category>,
    pub day_marks: Vec<DayMark>,
    pub settings: Settings,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(try_from = "serde_json::Value")]
pub struct Backup {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub water_entries: Option<Vec<WaterEntry>>,
    pub format: String,
    pub version: u32,
    pub exported_at: String,
    pub tasks: Vec<Task>,
    pub categories: Vec<Category>,
    pub day_marks: Vec<DayMark>,
    pub settings: Settings,
}
impl TryFrom<serde_json::Value> for Backup {
    type Error = String;
    fn try_from(value: serde_json::Value) -> Result<Self> {
        let version = value
            .get("version")
            .and_then(|v| v.as_u64())
            .ok_or("备份版本无效")?;
        match version {
            1 if value.get("water_entries").is_some() => {
                return Err("V1备份不能包含饮水字段".into())
            }
            2 if !value.get("water_entries").is_some_and(|v| v.is_array()) => {
                return Err("V2备份必须包含饮水记录数组".into())
            }
            1 | 2 => {}
            _ => return Err("不支持的备份版本，请使用支持该格式的应用".into()),
        }
        #[derive(Deserialize)]
        struct Wire {
            format: String,
            version: u32,
            exported_at: String,
            tasks: Vec<Task>,
            categories: Vec<Category>,
            day_marks: Vec<DayMark>,
            settings: Settings,
            #[serde(default)]
            water_entries: Option<Vec<WaterEntry>>,
        }
        let w: Wire = serde_json::from_value(value).map_err(error)?;
        Ok(Self {
            format: w.format,
            version: w.version,
            exported_at: w.exported_at,
            tasks: w.tasks,
            categories: w.categories,
            day_marks: w.day_marks,
            settings: w.settings,
            water_entries: w.water_entries,
        })
    }
}
pub const MAX_WATER_ENTRIES: usize = 100000;
pub const MAX_BACKUP_BYTES: usize = 32 * 1024 * 1024;
pub fn valid_date(s: &str) -> bool {
    s.len() == 10
        && NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok_and(|d| {
            d.year() >= 1900 && d.year() <= 9999 && d.format("%Y-%m-%d").to_string() == s
        })
}
pub fn validate_task(t: &Task) -> Result<()> {
    if t.id.is_empty()
        || t.id.len() > 128
        || !valid_date(&t.date)
        || t.title.trim().is_empty()
        || t.title.chars().count() > 500
        || t.priority > 2
        || t.sort_order < 0
        || t.sort_order > 2147483647
        || t.short_label
            .as_ref()
            .is_some_and(|s| s.chars().count() > 100)
        || t.description
            .as_ref()
            .is_some_and(|s| s.chars().count() > 100000)
        || chrono::DateTime::parse_from_rfc3339(&t.created_at).is_err()
        || chrono::DateTime::parse_from_rfc3339(&t.updated_at).is_err()
    {
        return Err("任务结构或日期无效".into());
    }
    Ok(())
}
pub fn validate_settings(s: &Settings) -> Result<()> {
    if !(1..=20000).contains(&s.water_goal)
        || !["overview", "focus"].contains(&s.active_view.as_str())
        || !["reading", "glass", "frosted"].contains(&s.appearance_mode.as_str())
        || !["small", "standard", "large"].contains(&s.text_size.as_str())
        || !["classic", "compact"].contains(&s.header_layout.as_str())
        || !["rolling", "week"].contains(&s.agenda_range.as_str())
        || !s.background_opacity.is_finite()
        || !(0.4..=1.).contains(&s.background_opacity)
    {
        return Err("设置无效".into());
    }
    Ok(())
}
fn validate_mark(m: &DayMark) -> Result<()> {
    if !valid_date(&m.date)
        || !["rest", "overtime"].contains(&m.kind.as_str())
        || m.note.as_ref().is_some_and(|s| s.chars().count() > 500)
    {
        return Err("个人日期标记无效".into());
    }
    Ok(())
}
pub fn migrate(conn: &mut Connection) -> Result<()> {
    conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;").map_err(error)?;
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(error)?;
    if version > 2 {
        return Err("数据库来自更新版本，请升级应用".into());
    }
    if version == 0 {
        let tx = conn.transaction().map_err(error)?;
        tx.execute_batch(include_str!("../migrations/001_initial.sql"))
            .map_err(error)?;
        tx.execute(
            "INSERT INTO app_settings VALUES (1,?1)",
            [serde_json::to_string(&Settings::default()).map_err(error)?],
        )
        .map_err(error)?;
        tx.execute_batch("PRAGMA user_version=1").map_err(error)?;
        tx.commit().map_err(error)?;
    }
    if version < 2 {
        let tx = conn.transaction().map_err(error)?;
        tx.execute_batch(include_str!("../migrations/002_water.sql"))
            .map_err(error)?;
        tx.commit().map_err(error)?;
    }
    Ok(())
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WaterEntry {
    pub id: String,
    pub date: String,
    pub amount: u32,
    pub recorded_at: String,
}
fn valid_water_timestamp(s: &str) -> bool {
    if !s.is_ascii()
        || s.len() < 20
        || s.as_bytes()[10] != b'T'
        || s.as_bytes()[13] != b':'
        || s.as_bytes()[16] != b':'
        || !s[..4].bytes().all(|b| b.is_ascii_digit())
        || s[17..19].parse::<u8>().map_or(true, |v| v > 59)
        || chrono::DateTime::parse_from_rfc3339(s).is_err()
    {
        return false;
    }
    let end = if s.ends_with('Z') {
        s.len() - 1
    } else {
        let zone = &s[s.len() - 6..];
        if !matches!(zone.as_bytes()[0], b'+' | b'-') || zone.as_bytes()[3] != b':' {
            return false;
        }
        s.len() - 6
    };
    let fraction = &s[19..end];
    fraction.is_empty()
        || (fraction.starts_with('.')
            && fraction.len() > 1
            && fraction[1..].bytes().all(|b| b.is_ascii_digit()))
}
pub fn validate_water(entry: &WaterEntry) -> Result<()> {
    if entry.id.is_empty()
        || entry.id.len() > 128
        || !valid_date(&entry.date)
        || !(1..=10000).contains(&entry.amount)
        || !valid_water_timestamp(&entry.recorded_at)
    {
        return Err("饮水记录无效".into());
    }
    Ok(())
}
pub fn save_water(conn: &Connection, entry: &WaterEntry) -> Result<()> {
    validate_water(entry)?;
    conn.execute("INSERT INTO water_entries(id,date,amount,recorded_at) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO NOTHING", params![entry.id,entry.date,entry.amount,entry.recorded_at]).map_err(error)?;
    Ok(())
}
pub fn delete_water(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM water_entries WHERE id=?1", [id])
        .map_err(error)?;
    Ok(())
}
pub fn snapshot(conn: &Connection) -> Result<Snapshot> {
    let mut stmt=conn.prepare("SELECT id,date,title,short_label,description,completed,priority,category_id,sort_order,created_at,updated_at FROM tasks ORDER BY date,completed,sort_order,id").map_err(error)?;
    let tasks = stmt
        .query_map([], |r| {
            Ok(Task {
                id: r.get(0)?,
                date: r.get(1)?,
                title: r.get(2)?,
                short_label: r.get(3)?,
                description: r.get(4)?,
                completed: r.get(5)?,
                priority: r.get(6)?,
                category_id: r.get(7)?,
                sort_order: r.get(8)?,
                created_at: r.get(9)?,
                updated_at: r.get(10)?,
            })
        })
        .map_err(error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(error)?;
    let mut stmt = conn
        .prepare("SELECT id,name,color,is_builtin,sort_order FROM categories ORDER BY sort_order")
        .map_err(error)?;
    let categories = stmt
        .query_map([], |r| {
            Ok(Category {
                id: r.get(0)?,
                name: r.get(1)?,
                color: r.get(2)?,
                is_builtin: r.get(3)?,
                sort_order: r.get(4)?,
            })
        })
        .map_err(error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(error)?;
    let mut stmt = conn
        .prepare("SELECT date,kind,note FROM day_marks ORDER BY date")
        .map_err(error)?;
    let day_marks = stmt
        .query_map([], |r| {
            Ok(DayMark {
                date: r.get(0)?,
                kind: r.get(1)?,
                note: r.get(2)?,
            })
        })
        .map_err(error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(error)?;
    let raw: String = conn
        .query_row("SELECT value FROM app_settings WHERE id=1", [], |r| {
            r.get(0)
        })
        .map_err(error)?;
    let settings: Settings = serde_json::from_str(&raw).map_err(error)?;
    validate_settings(&settings)?;
    let mut stmt = conn
        .prepare("SELECT id,date,amount,recorded_at FROM water_entries ORDER BY recorded_at,id")
        .map_err(error)?;
    let water_entries = stmt
        .query_map([], |r| {
            Ok(WaterEntry {
                id: r.get(0)?,
                date: r.get(1)?,
                amount: r.get(2)?,
                recorded_at: r.get(3)?,
            })
        })
        .map_err(error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(error)?;
    Ok(Snapshot {
        water_entries,
        tasks,
        categories,
        day_marks,
        settings,
    })
}
pub fn save_task(conn: &Connection, t: &Task) -> Result<()> {
    validate_task(t)?;
    conn.execute("INSERT INTO tasks (id,date,title,short_label,description,completed,priority,category_id,sort_order,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11) ON CONFLICT(id) DO UPDATE SET date=excluded.date,title=excluded.title,short_label=excluded.short_label,description=excluded.description,completed=excluded.completed,priority=excluded.priority,category_id=excluded.category_id,sort_order=excluded.sort_order,updated_at=excluded.updated_at",params![t.id,t.date,t.title.trim(),t.short_label,t.description,t.completed,t.priority,t.category_id,t.sort_order,t.created_at,t.updated_at]).map_err(error)?;
    Ok(())
}
pub fn save_settings(conn: &Connection, s: &Settings) -> Result<()> {
    validate_settings(s)?;
    conn.execute(
        "UPDATE app_settings SET value=?1 WHERE id=1",
        [serde_json::to_string(s).map_err(error)?],
    )
    .map_err(error)?;
    Ok(())
}
pub fn save_mark(conn: &Connection, date: &str, mark: Option<&DayMark>) -> Result<()> {
    if !valid_date(date) {
        return Err("日期无效".into());
    }
    if let Some(m) = mark {
        validate_mark(m)?;
        if m.date != date {
            return Err("日期不一致".into());
        }
        conn.execute("INSERT INTO day_marks VALUES(?1,?2,?3) ON CONFLICT(date) DO UPDATE SET kind=excluded.kind,note=excluded.note",params![m.date,m.kind,m.note]).map_err(error)?;
    } else {
        conn.execute("DELETE FROM day_marks WHERE date=?1", [date])
            .map_err(error)?;
    }
    Ok(())
}
pub fn reorder(conn: &mut Connection, date: &str, ids: &[String]) -> Result<()> {
    let tx = conn.transaction().map_err(error)?;
    let tasks = snapshot(&tx)?.tasks;
    let mut done = false;
    for id in ids {
        if let Some(task) = tasks.iter().find(|t| t.id == *id && t.date == date) {
            if task.completed {
                done = true;
            } else if done {
                return Err("不能跨完成状态排序".into());
            }
        }
    }
    let current = tasks
        .into_iter()
        .filter(|t| t.date == date)
        .map(|t| t.id)
        .collect::<HashSet<_>>();
    if ids.len() != current.len()
        || ids.iter().collect::<HashSet<_>>().len() != ids.len()
        || ids.iter().any(|id| !current.contains(id))
    {
        return Err("排序列表已变更，请重试".into());
    }
    for (index, id) in ids.iter().enumerate() {
        tx.execute(
            "UPDATE tasks SET sort_order=?1,updated_at=?2 WHERE id=?3",
            params![index as i64, Utc::now().to_rfc3339(), id],
        )
        .map_err(error)?;
    }
    tx.commit().map_err(error)
}
pub fn export(conn: &Connection) -> Result<Backup> {
    let tx = conn.unchecked_transaction().map_err(error)?;
    for (table, limit) in [
        ("tasks", 50000),
        ("categories", 1000),
        ("day_marks", 50000),
        ("water_entries", MAX_WATER_ENTRIES),
    ] {
        let count: usize = tx
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .map_err(error)?;
        if count > limit {
            return Err("完整数据超过备份记录数量上限，未导出；请保留完整数据目录备份".into());
        }
    }
    // Bound the source text before allocating a complete snapshot. Serialization
    // applies a second byte bound for JSON escaping/formatting overhead.
    let bytes: usize = tx.query_row("SELECT (SELECT COALESCE(SUM(length(CAST(id||date||title||COALESCE(short_label,'')||COALESCE(description,'')||COALESCE(category_id,'')||created_at||updated_at AS BLOB))),0) FROM tasks) + (SELECT COALESCE(SUM(length(CAST(id||name||color AS BLOB))),0) FROM categories) + (SELECT COALESCE(SUM(length(CAST(date||kind||COALESCE(note,'') AS BLOB))),0) FROM day_marks) + (SELECT COALESCE(SUM(length(CAST(id||date||recorded_at AS BLOB))),0) FROM water_entries) + (SELECT length(CAST(value AS BLOB)) FROM app_settings WHERE id=1)", [], |r|r.get(0)).map_err(error)?;
    if bytes > MAX_BACKUP_BYTES {
        return Err("完整备份超过32 MB，未导出；请保留完整数据目录备份".into());
    }
    let s = snapshot(&tx)?;
    tx.commit().map_err(error)?;
    let b = Backup {
        format: "starry-list".into(),
        version: 2,
        water_entries: Some(s.water_entries),
        exported_at: Utc::now().to_rfc3339(),
        tasks: s.tasks,
        categories: s.categories,
        day_marks: s.day_marks,
        settings: s.settings,
    };
    validate_backup(&b)?;
    Ok(b)
}
pub fn validate_backup(b: &Backup) -> Result<()> {
    if b.format != "starry-list"
        || ![1, 2].contains(&b.version)
        || (b.version == 1 && b.water_entries.is_some())
        || (b.version == 2 && b.water_entries.is_none())
        || b.tasks.len() > 50000
        || b.categories.len() > 1000
        || b.day_marks.len() > 50000
        || chrono::DateTime::parse_from_rfc3339(&b.exported_at).is_err()
    {
        return Err("不支持的备份版本或结构".into());
    }
    let mut water_ids = HashSet::new();
    if let Some(entries) = &b.water_entries {
        if entries.len() > MAX_WATER_ENTRIES {
            return Err("饮水记录超过100000条上限".into());
        }
        for entry in entries {
            validate_water(entry)?;
            if !water_ids.insert(&entry.id) {
                return Err("饮水记录ID重复".into());
            }
        }
    }
    validate_settings(&b.settings)?;
    let mut cats = HashSet::new();
    for c in &b.categories {
        if c.id.is_empty()
            || c.id.len() > 128
            || !cats.insert(&c.id)
            || c.name.trim().is_empty()
            || c.name.chars().count() > 40
            || c.color.len() != 7
            || !c.color.starts_with('#')
            || !c.color[1..].bytes().all(|v| v.is_ascii_hexdigit())
            || c.sort_order < 0
        {
            return Err("分类数据无效或重复".into());
        }
    }
    let mut tasks = HashSet::new();
    for t in &b.tasks {
        validate_task(t)?;
        if !tasks.insert(&t.id) || t.category_id.as_ref().is_some_and(|id| !cats.contains(id)) {
            return Err("任务重复或分类引用无效".into());
        }
    }
    let mut marks = HashSet::new();
    for m in &b.day_marks {
        validate_mark(m)?;
        if !marks.insert(&m.date) {
            return Err("个人标记重复".into());
        }
    }
    Ok(())
}
pub fn import(conn: &mut Connection, b: Backup, replace: bool) -> Result<Snapshot> {
    validate_backup(&b)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(error)?;
    let old = snapshot(&tx)?;
    if !replace {
        let existing: HashMap<_, _> = old.water_entries.iter().map(|e| (&e.id, e)).collect();
        for entry in b.water_entries.iter().flatten() {
            if existing.get(&entry.id).is_some_and(|e| **e != *entry) {
                return Err("饮水记录ID冲突，整个导入已取消；本机数据未改变".into());
            }
        }
    }
    if replace {
        tx.execute_batch("DELETE FROM tasks; DELETE FROM day_marks; DELETE FROM categories;")
            .map_err(error)?;
    }
    if replace && b.version == 2 {
        tx.execute("DELETE FROM water_entries", []).map_err(error)?;
    }
    for entry in b.water_entries.iter().flatten() {
        save_water(&tx, entry)?;
    }
    let mut cat_map = HashMap::new();
    for c in b.categories {
        let conflict = if replace {
            None
        } else {
            old.categories.iter().find(|o| o.id == c.id)
        };
        let id = match conflict {
            Some(o) if o.name != c.name || o.color != c.color => uuid::Uuid::new_v4().to_string(),
            _ => c.id.clone(),
        };
        if conflict.is_none() || id != c.id {
            tx.execute(
                "INSERT INTO categories VALUES(?1,?2,?3,?4,?5)",
                params![id, c.name, c.color, c.is_builtin, c.sort_order],
            )
            .map_err(error)?;
        }
        cat_map.insert(c.id, id);
    }
    let existing = old
        .tasks
        .iter()
        .map(|t| t.id.as_str())
        .collect::<HashSet<_>>();
    let mut used = existing
        .iter()
        .map(|s| s.to_string())
        .chain(b.tasks.iter().map(|t| t.id.clone()))
        .collect::<HashSet<_>>();
    for mut t in b.tasks {
        if !replace && existing.contains(t.id.as_str()) {
            loop {
                let id = uuid::Uuid::new_v4().to_string();
                if used.insert(id.clone()) {
                    t.id = id;
                    break;
                }
            }
        }
        t.category_id = t.category_id.map(|id| cat_map[&id].clone());
        save_task(&tx, &t)?;
    }
    for m in b.day_marks {
        if replace || !old.day_marks.iter().any(|o| o.date == m.date) {
            save_mark(&tx, &m.date, Some(&m))?;
        }
    }
    if replace {
        save_settings(&tx, &b.settings)?;
    }
    let restored = snapshot(&tx)?;
    tx.commit().map_err(error)?;
    Ok(restored)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn connection() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        migrate(&mut c).unwrap();
        c
    }
    fn task() -> Task {
        Task {
            id: "one".into(),
            date: "2026-10-14".into(),
            title: "研究计划".into(),
            short_label: None,
            description: Some("中文\n1. 范围\n2. 目标".repeat(1000)),
            completed: false,
            priority: 2,
            category_id: Some("work".into()),
            sort_order: 0,
            created_at: Utc::now().to_rfc3339(),
            updated_at: Utc::now().to_rfc3339(),
        }
    }
    #[test]
    fn migration_is_repeatable() {
        let mut c = connection();
        migrate(&mut c).unwrap();
        assert_eq!(snapshot(&c).unwrap().categories.len(), 6);
    }
    #[test]
    fn legacy_settings_and_backup_default_to_reading_without_schema_change() {
        let c = connection();
        save_task(&c, &task()).unwrap();
        let mut legacy = serde_json::to_value(Settings::default()).unwrap();
        legacy.as_object_mut().unwrap().remove("appearance_mode");
        c.execute(
            "UPDATE app_settings SET value=?1 WHERE id=1",
            [legacy.to_string()],
        )
        .unwrap();
        assert_eq!(snapshot(&c).unwrap().settings.appearance_mode, "reading");
        let raw: String = c
            .query_row("SELECT value FROM app_settings", [], |r| r.get(0))
            .unwrap();
        assert!(
            !raw.contains("appearance_mode"),
            "Loading must not rewrite legacy settings"
        );
        assert_eq!(
            c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            2
        );
        let mut b = serde_json::to_value(export(&c).unwrap()).unwrap();
        b["settings"]
            .as_object_mut()
            .unwrap()
            .remove("appearance_mode");
        let backup: Backup = serde_json::from_value(b).unwrap();
        assert_eq!(backup.settings.appearance_mode, "reading");
        assert_eq!(snapshot(&c).unwrap().tasks.len(), 1);
    }
    #[test]
    fn appearance_roundtrips_and_invalid_values_preserve_settings() {
        let c = connection();
        let mut s = Settings::default();
        for mode in ["reading", "glass", "frosted"] {
            s.appearance_mode = mode.into();
            save_settings(&c, &s).unwrap();
            assert_eq!(snapshot(&c).unwrap().settings.appearance_mode, mode);
            let exported = export(&c).unwrap();
            assert_eq!(exported.settings.appearance_mode, mode);
        }
        s.appearance_mode = "unknown".into();
        assert!(save_settings(&c, &s).is_err());
        assert_eq!(snapshot(&c).unwrap().settings.appearance_mode, "frosted");
    }
    #[test]
    fn text_size_legacy_backup_and_roundtrip_without_migration() {
        let mut c = connection();
        save_task(&c, &task()).unwrap();
        let mut legacy = serde_json::to_value(Settings::default()).unwrap();
        legacy.as_object_mut().unwrap().remove("text_size");
        legacy.as_object_mut().unwrap().remove("header_layout");
        c.execute(
            "UPDATE app_settings SET value=?1 WHERE id=1",
            [legacy.to_string()],
        )
        .unwrap();
        assert_eq!(snapshot(&c).unwrap().settings.text_size, "standard");
        assert_eq!(snapshot(&c).unwrap().settings.header_layout, "classic");
        let raw: String = c
            .query_row("SELECT value FROM app_settings", [], |r| r.get(0))
            .unwrap();
        assert!(
            !raw.contains("text_size"),
            "Reading legacy JSON must not rewrite settings"
        );
        assert!(!raw.contains("header_layout"));
        let mut old_backup = serde_json::to_value(export(&c).unwrap()).unwrap();
        old_backup["settings"]
            .as_object_mut()
            .unwrap()
            .remove("text_size");
        old_backup["settings"]
            .as_object_mut()
            .unwrap()
            .remove("header_layout");
        let backup: Backup = serde_json::from_value(old_backup).unwrap();
        import(&mut c, backup, true).unwrap();
        assert_eq!(snapshot(&c).unwrap().settings.text_size, "standard");
        assert_eq!(snapshot(&c).unwrap().settings.header_layout, "classic");
        let original = snapshot(&c).unwrap();
        for mode in ["reading", "glass", "frosted"] {
            for size in ["small", "standard", "large"] {
                for header in ["classic", "compact"] {
                    let mut s = original.settings.clone();
                    s.appearance_mode = mode.into();
                    s.text_size = size.into();
                    s.header_layout = header.into();
                    save_settings(&c, &s).unwrap();
                    let b = export(&c).unwrap();
                    assert_eq!(b.settings.text_size, size);
                    import(&mut c, b, true).unwrap();
                    let loaded = snapshot(&c).unwrap();
                    assert_eq!(loaded.settings.text_size, size);
                    assert_eq!(loaded.settings.appearance_mode, mode);
                    assert_eq!(loaded.settings.header_layout, header);
                    assert_eq!(loaded.tasks[0].title, original.tasks[0].title);
                }
            }
        }
        let mut invalid = snapshot(&c).unwrap().settings;
        invalid.text_size = "unknown".into();
        assert!(save_settings(&c, &invalid).is_err());
        assert_eq!(snapshot(&c).unwrap().settings.text_size, "large");
        invalid = snapshot(&c).unwrap().settings;
        invalid.header_layout = "invalid".into();
        assert!(save_settings(&c, &invalid).is_err());
        assert_eq!(snapshot(&c).unwrap().settings.header_layout, "compact");
        assert_eq!(
            c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            2
        );
    }
    #[test]
    fn agenda_range_legacy_roundtrip_and_settings_failure_preserve_tasks() {
        let mut c = connection();
        save_task(&c, &task()).unwrap();
        let original_tasks = serde_json::to_value(snapshot(&c).unwrap().tasks).unwrap();
        let mut legacy = serde_json::to_value(Settings::default()).unwrap();
        legacy.as_object_mut().unwrap().remove("agenda_range");
        let raw = legacy.to_string();
        c.execute("UPDATE app_settings SET value=?1 WHERE id=1", [&raw])
            .unwrap();
        assert_eq!(snapshot(&c).unwrap().settings.agenda_range, "rolling");
        assert_eq!(
            c.query_row("SELECT value FROM app_settings", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            raw
        );
        let mut old_backup = serde_json::to_value(export(&c).unwrap()).unwrap();
        old_backup["settings"]
            .as_object_mut()
            .unwrap()
            .remove("agenda_range");
        import(&mut c, serde_json::from_value(old_backup).unwrap(), true).unwrap();
        assert_eq!(snapshot(&c).unwrap().settings.agenda_range, "rolling");
        for range in ["rolling", "week"] {
            for appearance in ["reading", "glass", "frosted"] {
                for size in ["small", "standard", "large"] {
                    for header in ["classic", "compact"] {
                        let mut settings = snapshot(&c).unwrap().settings;
                        settings.agenda_range = range.into();
                        settings.appearance_mode = appearance.into();
                        settings.text_size = size.into();
                        settings.header_layout = header.into();
                        save_settings(&c, &settings).unwrap();
                        let backup = export(&c).unwrap();
                        assert_eq!(backup.settings.agenda_range, range);
                        import(&mut c, backup, true).unwrap();
                        assert_eq!(snapshot(&c).unwrap().settings.agenda_range, range);
                        assert_eq!(
                            serde_json::to_value(snapshot(&c).unwrap().tasks).unwrap(),
                            original_tasks
                        );
                    }
                }
            }
        }
        let mut settings = snapshot(&c).unwrap().settings;
        settings.agenda_range = "month".into();
        assert!(save_settings(&c, &settings).is_err());
        settings.agenda_range = "rolling".into();
        c.execute_batch("CREATE TRIGGER reject_range BEFORE UPDATE ON app_settings BEGIN SELECT RAISE(FAIL, 'range failure'); END;").unwrap();
        assert!(save_settings(&c, &settings).is_err());
        assert_eq!(snapshot(&c).unwrap().settings.agenda_range, "week");
        c.execute_batch("DROP TRIGGER reject_range;").unwrap();
        save_settings(&c, &settings).unwrap();
        assert_eq!(snapshot(&c).unwrap().settings.agenda_range, "rolling");
        assert_eq!(
            serde_json::to_value(snapshot(&c).unwrap().tasks).unwrap(),
            original_tasks
        );
        assert_eq!(
            c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            2
        );
    }
    #[test]
    fn long_text_and_priority_roundtrip() {
        let c = connection();
        let mut t = task();
        save_task(&c, &t).unwrap();
        t.completed = true;
        save_task(&c, &t).unwrap();
        let stored = snapshot(&c).unwrap().tasks.remove(0);
        assert_eq!(stored.description, t.description);
        assert_eq!(stored.priority, 2);
        assert!(stored.completed);
    }
    #[test]
    fn move_and_uncomplete() {
        let c = connection();
        let mut t = task();
        save_task(&c, &t).unwrap();
        t.date = "2027-01-01".into();
        t.completed = false;
        save_task(&c, &t).unwrap();
        assert_eq!(snapshot(&c).unwrap().tasks[0].date, "2027-01-01");
    }
    #[test]
    fn malformed_dates_rejected() {
        for d in ["2026-02-29", "2026-1-01", "1899-12-31", "2026-04-31"] {
            assert!(!valid_date(d));
        }
        assert!(valid_date("2024-02-29"));
    }
    #[test]
    fn merge_preserves_ids_and_marks() {
        let mut c = connection();
        save_task(&c, &task()).unwrap();
        let b = export(&c).unwrap();
        import(&mut c, b, false).unwrap();
        let s = snapshot(&c).unwrap();
        assert_eq!(s.tasks.len(), 2);
        assert_ne!(s.tasks[0].id, s.tasks[1].id);
        assert_eq!(s.categories.len(), 6);
    }
    #[test]
    fn invalid_import_preserves_database() {
        let mut c = connection();
        save_task(&c, &task()).unwrap();
        let mut b = export(&c).unwrap();
        b.tasks[0].priority = 8;
        assert!(import(&mut c, b, true).is_err());
        assert_eq!(snapshot(&c).unwrap().tasks.len(), 1);
    }
    #[test]
    fn replace_and_restore_settings() {
        let mut c = connection();
        save_task(&c, &task()).unwrap();
        let mut b = export(&c).unwrap();
        b.tasks.clear();
        b.settings.active_view = "focus".into();
        import(&mut c, b, true).unwrap();
        assert!(snapshot(&c).unwrap().tasks.is_empty());
        assert_eq!(snapshot(&c).unwrap().settings.active_view, "focus");
    }
    #[test]
    fn parameterized_title() {
        let c = connection();
        let mut t = task();
        t.title = "'; DROP TABLE tasks; --".into();
        save_task(&c, &t).unwrap();
        assert_eq!(snapshot(&c).unwrap().tasks[0].title, t.title);
    }
    #[test]
    fn reorder_groups_and_rollback() {
        let mut c = connection();
        let mut a = task();
        a.id = "a".into();
        let mut b = a.clone();
        b.id = "b".into();
        b.sort_order = 1;
        let mut d = a.clone();
        d.id = "d".into();
        d.completed = true;
        d.sort_order = 2;
        for t in [&a, &b, &d] {
            save_task(&c, t).unwrap();
        }
        let before = serde_json::to_value(snapshot(&c).unwrap().tasks).unwrap();
        assert!(reorder(&mut c, &a.date, &["d".into(), "a".into(), "b".into()]).is_err());
        c.execute_batch("CREATE TRIGGER sort_fail BEFORE UPDATE OF sort_order ON tasks WHEN NEW.id='a' BEGIN SELECT RAISE(ABORT,'sort failure'); END;").unwrap();
        assert!(reorder(&mut c, &a.date, &["b".into(), "a".into(), "d".into()]).is_err());
        assert_eq!(
            serde_json::to_value(snapshot(&c).unwrap().tasks).unwrap(),
            before
        );
        c.execute_batch("DROP TRIGGER sort_fail;").unwrap();
        reorder(&mut c, &a.date, &["b".into(), "a".into(), "d".into()]).unwrap();
        assert_eq!(
            snapshot(&c)
                .unwrap()
                .tasks
                .iter()
                .find(|t| t.id == "b")
                .unwrap()
                .sort_order,
            0
        );
    }
    #[test]
    fn reorder_validates_membership() {
        let mut c = connection();
        save_task(&c, &task()).unwrap();
        assert!(reorder(&mut c, "2026-10-14", &["absent".into()]).is_err());
        reorder(&mut c, "2026-10-14", &["one".into()]).unwrap();
    }
    #[test]
    fn restart_keeps_data() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("test.db");
        {
            let mut c = Connection::open(&p).unwrap();
            migrate(&mut c).unwrap();
            save_task(&c, &task()).unwrap();
        }
        let mut c = Connection::open(&p).unwrap();
        migrate(&mut c).unwrap();
        assert_eq!(snapshot(&c).unwrap().tasks.len(), 1);
    }
    #[test]
    fn import_rolls_back_after_sql_failure() {
        let mut c = connection();
        save_task(&c, &task()).unwrap();
        let mut b = export(&c).unwrap();
        b.tasks[0].title = "reject".into();
        c.execute_batch("CREATE TRIGGER reject_import BEFORE INSERT ON tasks WHEN NEW.title='reject' BEGIN SELECT RAISE(ABORT,'test write failure'); END;").unwrap();
        assert!(import(&mut c, b, true).is_err());
        assert_eq!(snapshot(&c).unwrap().tasks[0].title, "研究计划");
        assert_eq!(snapshot(&c).unwrap().categories.len(), 6);
    }
    #[test]
    fn water_migration_persistence_and_backup_isolation() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("water.db");
        {
            let mut c = Connection::open(&path).unwrap();
            // Model an existing v1 database, without changing its original migration.
            c.execute_batch(include_str!("../migrations/001_initial.sql"))
                .unwrap();
            c.execute(
                "INSERT INTO app_settings VALUES(1,?1)",
                [serde_json::to_string(&Settings::default()).unwrap()],
            )
            .unwrap();
            c.execute_batch("PRAGMA user_version=1").unwrap();
            save_task(&c, &task()).unwrap();
            migrate(&mut c).unwrap();
            migrate(&mut c).unwrap();
            let entry = WaterEntry {
                id: "water-one".into(),
                date: "2026-10-28".into(),
                amount: 500,
                recorded_at: "2026-10-29T00:01:02+08:00".into(),
            };
            save_water(&c, &entry).unwrap();
            save_water(&c, &entry).unwrap();
            assert_eq!(snapshot(&c).unwrap().water_entries.len(), 1);
            let mut bad = entry.clone();
            bad.amount = 0;
            assert!(save_water(&c, &bad).is_err());
            bad.amount = 10001;
            assert!(save_water(&c, &bad).is_err());
            bad.amount = 250;
            bad.date = "2026-02-30".into();
            assert!(save_water(&c, &bad).is_err());
            let settings = Settings {
                water_enabled: true,
                water_goal: 1750,
                ..Settings::default()
            };
            save_settings(&c, &settings).unwrap();
            let mut backup = export(&c).unwrap();
            backup.version = 1;
            backup.water_entries = None;
            assert!(serde_json::to_value(&backup)
                .unwrap()
                .get("water_entries")
                .is_none());
            import(&mut c, backup, true).unwrap();
            assert_eq!(snapshot(&c).unwrap().water_entries.len(), 1);
            assert_eq!(snapshot(&c).unwrap().tasks.len(), 1);
        }
        let mut c = Connection::open(&path).unwrap();
        migrate(&mut c).unwrap();
        let s = snapshot(&c).unwrap();
        assert_eq!(s.water_entries[0].amount, 500);
        assert_eq!(s.water_entries[0].recorded_at, "2026-10-29T00:01:02+08:00");
        assert!(s.settings.water_enabled);
        assert_eq!(s.settings.water_goal, 1750);
        delete_water(&c, "water-one").unwrap();
        assert!(snapshot(&c).unwrap().water_entries.is_empty());
        assert_eq!(snapshot(&c).unwrap().tasks.len(), 1);
    }
    #[test]
    fn old_water_settings_default_and_goal_validation() {
        let mut value = serde_json::to_value(Settings::default()).unwrap();
        value.as_object_mut().unwrap().remove("water_goal");
        value.as_object_mut().unwrap().remove("water_enabled");
        let mut s: Settings = serde_json::from_value(value).unwrap();
        assert_eq!(s.water_goal, 2000);
        assert!(!s.water_enabled);
        s.water_goal = 0;
        assert!(validate_settings(&s).is_err());
        s.water_goal = 20001;
        assert!(validate_settings(&s).is_err());
    }
}
