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
            active_view: "overview".into(),
            background_opacity: 0.85,
            always_on_top: false,
            animations_enabled: true,
            show_holidays: true,
            show_weekends: true,
            opaque_fallback: false,
            appearance_mode: default_appearance(),
            text_size: default_text_size(),
        }
    }
}
#[derive(Debug, Serialize, Deserialize)]
pub struct Snapshot {
    pub tasks: Vec<Task>,
    pub categories: Vec<Category>,
    pub day_marks: Vec<DayMark>,
    pub settings: Settings,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct Backup {
    pub format: String,
    pub version: u32,
    pub exported_at: String,
    pub tasks: Vec<Task>,
    pub categories: Vec<Category>,
    pub day_marks: Vec<DayMark>,
    pub settings: Settings,
}
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
    if !["overview", "focus"].contains(&s.active_view.as_str())
        || !["reading", "glass", "frosted"].contains(&s.appearance_mode.as_str())
        || !["small", "standard", "large"].contains(&s.text_size.as_str())
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
    if version > 1 {
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
    Ok(Snapshot {
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
    let current = snapshot(conn)?
        .tasks
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
    let tx = conn.transaction().map_err(error)?;
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
    let s = snapshot(conn)?;
    Ok(Backup {
        format: "starry-list".into(),
        version: 1,
        exported_at: Utc::now().to_rfc3339(),
        tasks: s.tasks,
        categories: s.categories,
        day_marks: s.day_marks,
        settings: s.settings,
    })
}
pub fn validate_backup(b: &Backup) -> Result<()> {
    if b.format != "starry-list"
        || b.version != 1
        || b.tasks.len() > 50000
        || b.categories.len() > 1000
        || b.day_marks.len() > 50000
        || chrono::DateTime::parse_from_rfc3339(&b.exported_at).is_err()
    {
        return Err("不支持的备份版本或结构".into());
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
pub fn import(conn: &mut Connection, b: Backup, replace: bool) -> Result<()> {
    validate_backup(&b)?;
    let old = snapshot(conn)?;
    let tx = conn.transaction().map_err(error)?;
    if replace {
        tx.execute_batch("DELETE FROM tasks; DELETE FROM day_marks; DELETE FROM categories;")
            .map_err(error)?;
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
    tx.commit().map_err(error)
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
            1
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
        c.execute(
            "UPDATE app_settings SET value=?1 WHERE id=1",
            [legacy.to_string()],
        )
        .unwrap();
        assert_eq!(snapshot(&c).unwrap().settings.text_size, "standard");
        let raw: String = c
            .query_row("SELECT value FROM app_settings", [], |r| r.get(0))
            .unwrap();
        assert!(
            !raw.contains("text_size"),
            "Reading legacy JSON must not rewrite settings"
        );
        let mut old_backup = serde_json::to_value(export(&c).unwrap()).unwrap();
        old_backup["settings"]
            .as_object_mut()
            .unwrap()
            .remove("text_size");
        let backup: Backup = serde_json::from_value(old_backup).unwrap();
        import(&mut c, backup, true).unwrap();
        assert_eq!(snapshot(&c).unwrap().settings.text_size, "standard");
        let original = snapshot(&c).unwrap();
        for mode in ["reading", "glass", "frosted"] {
            for size in ["small", "standard", "large"] {
                let mut s = original.settings.clone();
                s.appearance_mode = mode.into();
                s.text_size = size.into();
                save_settings(&c, &s).unwrap();
                let b = export(&c).unwrap();
                assert_eq!(b.settings.text_size, size);
                import(&mut c, b, true).unwrap();
                let loaded = snapshot(&c).unwrap();
                assert_eq!(loaded.settings.text_size, size);
                assert_eq!(loaded.settings.appearance_mode, mode);
                assert_eq!(loaded.tasks[0].title, original.tasks[0].title);
            }
        }
        let mut invalid = snapshot(&c).unwrap().settings;
        invalid.text_size = "unknown".into();
        assert!(save_settings(&c, &invalid).is_err());
        assert_eq!(snapshot(&c).unwrap().settings.text_size, "large");
        assert_eq!(
            c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
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
}
