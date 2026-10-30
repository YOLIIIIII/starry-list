use crate::{backup_io, db::*};
use rusqlite::Connection;
fn conn() -> Connection {
    let mut c = Connection::open_in_memory().unwrap();
    migrate(&mut c).unwrap();
    c
}
fn water(id: &str, date: &str) -> WaterEntry {
    WaterEntry {
        id: id.into(),
        date: date.into(),
        amount: 500,
        recorded_at: "2026-10-30T09:49:00.123+08:00".into(),
    }
}
fn task(id: &str) -> Task {
    Task {
        id: id.into(),
        date: "2026-10-29".into(),
        title: "合成备份任务".into(),
        short_label: Some("合成".into()),
        description: Some("第一行\n第二行".into()),
        completed: false,
        priority: 2,
        category_id: None,
        sort_order: 0,
        created_at: "2026-10-29T00:00:00+08:00".into(),
        updated_at: "2026-10-29T00:00:00+08:00".into(),
    }
}
fn state(c: &Connection) -> serde_json::Value {
    serde_json::to_value(snapshot(c).unwrap()).unwrap()
}
fn parse(value: serde_json::Value) -> Result<Backup, String> {
    let b: Backup = serde_json::from_value(value).map_err(|e| e.to_string())?;
    validate_backup(&b)?;
    Ok(b)
}
#[test]
fn independent_file_databases_complete_roundtrip_and_restart() {
    let dir = tempfile::tempdir().unwrap();
    let mut a = Connection::open(dir.path().join("a.db")).unwrap();
    migrate(&mut a).unwrap();
    save_task(&a, &task("one")).unwrap();
    save_mark(
        &a,
        "2026-10-29",
        Some(&DayMark {
            date: "2026-10-29".into(),
            kind: "rest".into(),
            note: Some("合成标记".into()),
        }),
    )
    .unwrap();
    let settings = Settings {
        water_enabled: true,
        water_goal: 2500,
        text_size: "large".into(),
        ..Settings::default()
    };
    save_settings(&a, &settings).unwrap();
    for (id, date) in [
        ("w1", "2026-10-29"),
        ("w2", "2026-10-30"),
        ("w3", "2030-01-01"),
    ] {
        let mut e = water(id, date);
        if id == "w3" {
            e.recorded_at = "2026-10-30T03:01:02-05:00".into();
        }
        save_water(&a, &e).unwrap();
    }
    let original = state(&a);
    let backup = export(&a).unwrap();
    assert_eq!(backup.version, 2);
    assert_eq!(backup.water_entries.as_ref().unwrap().len(), 3);
    let file = dir.path().join("complete.json");
    backup_io::write(&file, &backup).unwrap();
    let imported = backup_io::read(&file).unwrap();
    {
        let mut b = Connection::open(dir.path().join("b.db")).unwrap();
        migrate(&mut b).unwrap();
        import(&mut b, imported, true).unwrap();
        assert_eq!(state(&b), original);
    }
    let mut b = Connection::open(dir.path().join("b.db")).unwrap();
    migrate(&mut b).unwrap();
    assert_eq!(state(&b), original);
    assert_eq!(
        b.query_row("PRAGMA user_version", [], |r| r.get::<_, u32>(0))
            .unwrap(),
        2
    );
}
#[test]
fn merge_is_idempotent_for_water_and_conflicts_abort_everything() {
    let a = conn();
    save_water(&a, &water("same", "2026-10-29")).unwrap();
    save_water(&a, &water("other", "2026-10-29")).unwrap();
    let mut b = conn();
    save_water(&b, &water("local", "2026-10-28")).unwrap();
    for _ in 0..2 {
        import(&mut b, export(&a).unwrap(), false).unwrap();
    }
    assert_eq!(snapshot(&b).unwrap().water_entries.len(), 3);
    let before = state(&b);
    let mut backup = export(&a).unwrap();
    backup.tasks.push(task("should-not-write"));
    backup.water_entries.as_mut().unwrap()[0].amount = 250;
    assert!(import(&mut b, backup, false).unwrap_err().contains("冲突"));
    assert_eq!(state(&b), before);
}
#[test]
fn versioned_replace_and_legacy_defaults() {
    let source = conn();
    let mut c = conn();
    save_water(&c, &water("local", "2026-10-29")).unwrap();
    save_task(&c, &task("old-task")).unwrap();
    for replace in [false, true] {
        let mut legacy = export(&source).unwrap();
        legacy.version = 1;
        legacy.water_entries = None;
        let mut wire = serde_json::to_value(legacy).unwrap();
        for k in [
            "appearance_mode",
            "text_size",
            "header_layout",
            "agenda_range",
            "water_enabled",
            "water_goal",
        ] {
            wire["settings"].as_object_mut().unwrap().remove(k);
        }
        let b = parse(wire).unwrap();
        assert_eq!(b.settings.water_goal, 2000);
        assert!(!b.settings.water_enabled);
        import(&mut c, b, replace).unwrap();
        assert_eq!(snapshot(&c).unwrap().water_entries.len(), 1);
    }
    let b = export(&source).unwrap();
    assert!(b.water_entries.as_ref().unwrap().is_empty());
    import(&mut c, b, true).unwrap();
    assert!(snapshot(&c).unwrap().water_entries.is_empty());
    assert!(snapshot(&c).unwrap().tasks.is_empty());
}
#[test]
fn last_step_sql_failure_rolls_back_all_five_domains() {
    let source = conn();
    save_task(&source, &task("new-task")).unwrap();
    save_water(&source, &water("new-water", "2026-10-30")).unwrap();
    save_mark(
        &source,
        "2026-10-30",
        Some(&DayMark {
            date: "2026-10-30".into(),
            kind: "overtime".into(),
            note: None,
        }),
    )
    .unwrap();
    let mut c = conn();
    save_task(&c, &task("old-task")).unwrap();
    save_water(&c, &water("old-water", "2026-10-29")).unwrap();
    let before = state(&c);
    c.execute_batch("CREATE TRIGGER reject_restore BEFORE UPDATE ON app_settings BEGIN SELECT RAISE(ABORT,'synthetic final-step failure'); END;").unwrap();
    assert!(import(&mut c, export(&source).unwrap(), true).is_err());
    assert_eq!(state(&c), before);
    c.execute_batch("DROP TRIGGER reject_restore;").unwrap();
    import(&mut c, export(&source).unwrap(), true).unwrap();
    assert_eq!(state(&c), state(&source));
}
#[test]
fn invalid_formats_and_water_are_rejected_before_writes() {
    let a = conn();
    let mut c = conn();
    save_water(&c, &water("safe", "2026-10-29")).unwrap();
    let before = state(&c);
    let base = serde_json::to_value(export(&a).unwrap()).unwrap();
    for patch in [
        serde_json::json!({"version":3}),
        serde_json::json!({"version":2,"water_entries":null}),
        serde_json::json!({"version":1,"water_entries":[]}),
    ] {
        let mut v = base.clone();
        for (k, val) in patch.as_object().unwrap() {
            v[k] = val.clone();
        }
        assert!(parse(v).is_err());
    }
    let mut missing = base.clone();
    missing.as_object_mut().unwrap().remove("water_entries");
    assert!(parse(missing).is_err());
    for patch in [
        serde_json::json!({"id":""}),
        serde_json::json!({"id":"水".repeat(64)}),
        serde_json::json!({"date":"2026-02-30"}),
        serde_json::json!({"amount":0}),
        serde_json::json!({"amount":10001}),
        serde_json::json!({"amount":1.5}),
        serde_json::json!({"amount":"500"}),
        serde_json::json!({"recorded_at":"2026-10-30T09:00:00"}),
        serde_json::json!({"recorded_at":"2026-10-30T09:00+08:00"}),
        serde_json::json!({"recorded_at":"2026-10-30 09:00:00+08:00"}),
        serde_json::json!({"recorded_at":"2026-10-30T09:00:00+99:99"}),
    ] {
        let mut e = serde_json::to_value(water("w", "2026-10-30")).unwrap();
        for (k, val) in patch.as_object().unwrap() {
            e[k] = val.clone();
        }
        let mut v = base.clone();
        v["water_entries"] = serde_json::json!([e]);
        assert!(parse(v).is_err());
        assert_eq!(state(&c), before);
    }
    let mut b = export(&a).unwrap();
    b.water_entries = Some(vec![
        water("duplicate", "2026-10-30"),
        water("duplicate", "2026-10-30"),
    ]);
    assert!(import(&mut c, b, true).is_err());
    assert_eq!(state(&c), before);
}
#[test]
fn count_limit_and_escaped_serialization_bound_are_explicit() {
    let c = conn();
    let mut b = export(&c).unwrap();
    b.water_entries = Some(
        (0..MAX_WATER_ENTRIES)
            .map(|i| water(&format!("w{i}"), "2026-10-30"))
            .collect(),
    );
    validate_backup(&b).unwrap();
    b.water_entries
        .as_mut()
        .unwrap()
        .push(water("extra", "2026-10-30"));
    assert!(validate_backup(&b).is_err());
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("existing.json");
    std::fs::write(&file, b"original").unwrap();
    let mut b = export(&c).unwrap();
    for i in 0..60 {
        let mut t = task(&format!("t{i}"));
        t.description = Some("\0".repeat(100000));
        b.tasks.push(t);
    }
    assert!(backup_io::write(&file, &b).unwrap_err().contains("32 MB"));
    assert_eq!(std::fs::read(&file).unwrap(), b"original");
}
