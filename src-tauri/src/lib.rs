mod db;
#[cfg(target_os = "windows")]
mod material;
use db::{Backup, DayMark, Settings, Snapshot, Task};
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_window_state::StateFlags;
struct Database(Mutex<Connection>);
#[tauri::command]
async fn native_frost_active(window: tauri::WebviewWindow) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let (send, receive) = std::sync::mpsc::sync_channel(1);
        window
            .run_on_main_thread(move || {
                let _ = send.send(material::active());
            })
            .map_err(|e| e.to_string())?;
        tauri::async_runtime::spawn_blocking(move || receive.recv().map_err(|e| e.to_string()))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
        Ok(false)
    }
}
#[tauri::command]
async fn native_frost(window: tauri::WebviewWindow, enabled: bool) -> Result<bool, String> {
    if window.label() != "main" {
        return Err("不支持的窗口".into());
    }
    #[cfg(target_os = "windows")]
    {
        if enabled && !native_frost_supported(window.app_handle().clone()) {
            return Ok(false);
        }
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as usize;
        let (send, receive) = std::sync::mpsc::sync_channel(1);
        window
            .run_on_main_thread(move || {
                let _ = send.send(material::set(
                    windows::Win32::Foundation::HWND(hwnd as _),
                    enabled,
                ));
            })
            .map_err(|e| e.to_string())?;
        tauri::async_runtime::spawn_blocking(move || receive.recv().map_err(|e| e.to_string())?)
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = enabled;
        Ok(false)
    }
}
#[tauri::command]
fn native_transparency(app: tauri::AppHandle) -> bool {
    app.config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .is_some_and(|w| w.transparent)
}
#[tauri::command]
fn native_frost_supported(app: tauri::AppHandle) -> bool {
    if !native_transparency(app) {
        return false;
    }
    // Keep the established modern-Windows compatibility floor for composition.
    #[cfg(target_os = "windows")]
    {
        windows_version::OsVersion::current().build >= 22621
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}
fn lock(state: &Database) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    state
        .0
        .lock()
        .map_err(|_| "数据库锁异常，请重启应用".into())
}
#[tauri::command]
fn load_snapshot(state: State<Database>) -> Result<Snapshot, String> {
    db::snapshot(&*lock(&state)?)
}
#[tauri::command]
fn save_task(state: State<Database>, task: Task) -> Result<(), String> {
    db::save_task(&*lock(&state)?, &task)
}
#[tauri::command]
fn delete_task(state: State<Database>, id: String) -> Result<(), String> {
    lock(&state)?
        .execute("DELETE FROM tasks WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
fn save_settings(state: State<Database>, settings: Settings) -> Result<(), String> {
    db::save_settings(&*lock(&state)?, &settings)
}
#[tauri::command]
fn save_mark(state: State<Database>, date: String, mark: Option<DayMark>) -> Result<(), String> {
    db::save_mark(&*lock(&state)?, &date, mark.as_ref())
}
#[tauri::command]
fn reorder_tasks(state: State<Database>, date: String, ids: Vec<String>) -> Result<(), String> {
    db::reorder(&mut *lock(&state)?, &date, &ids)
}
#[tauri::command]
fn export_backup(state: State<Database>, path: String) -> Result<(), String> {
    let backup = db::export(&*lock(&state)?)?;
    let dest = std::path::Path::new(&path);
    let parent = dest.parent().ok_or("导出路径无效")?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    use std::io::Write;
    temp.write_all(
        serde_json::to_string_pretty(&backup)
            .map_err(|e| e.to_string())?
            .as_bytes(),
    )
    .map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(dest).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
fn read_backup(path: String) -> Result<Backup, String> {
    let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if metadata.len() > 32 * 1024 * 1024 {
        return Err("备份文件不能超过 32 MB".into());
    }
    let data = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let b: Backup = serde_json::from_str(&data).map_err(|e| format!("备份格式错误：{e}"))?;
    db::validate_backup(&b)?;
    Ok(b)
}
#[tauri::command]
fn import_backup(state: State<Database>, backup: Backup, replace: bool) -> Result<(), String> {
    db::import(&mut *lock(&state)?, backup, replace)
}
pub fn run() {
    let test_dir = if cfg!(debug_assertions) {
        std::env::var_os("STARRY_LIST_TEST_DATA_DIR").map(std::path::PathBuf::from)
    } else {
        None
    };
    let window_flags = StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED;
    // The frontend restores after WebView2 initialization, before showing the
    // window. Early window-ready sizing can use unsettled frame metrics.
    let mut window_state = tauri_plugin_window_state::Builder::default()
        .with_state_flags(window_flags)
        .skip_initial_state("main");
    if let Some(dir) = &test_dir {
        window_state = window_state.with_filename(dir.join("window-state.json").to_string_lossy());
    }
    tauri::Builder::default()
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                #[cfg(target_os = "windows")]
                material::clear();
            }
        })
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(window_state.build())
        .setup(move |app| {
            let setup_database = || -> Result<Connection, Box<dyn std::error::Error>> {
                let dir = match &test_dir {
                    Some(dir) if dir.is_absolute() => dir.clone(),
                    Some(_) => return Err("测试数据路径必须为绝对路径".into()),
                    None => app.path().app_data_dir()?,
                };
                std::fs::create_dir_all(&dir)?;
                let mut conn = Connection::open(dir.join("starry-list.db"))?;
                db::migrate(&mut conn).map_err(std::io::Error::other)?;
                Ok(conn)
            };
            match setup_database() {
                Ok(conn) => {
                    app.manage(Database(Mutex::new(conn)));
                    Ok(())
                }
                Err(error) => {
                    app.dialog().message(format!("无法读取本地数据库：{error}\n\n请检查磁盘空间和应用数据目录权限。原有数据没有被清空。"))
                        .title("星轨日历启动失败")
                        .kind(tauri_plugin_dialog::MessageDialogKind::Error)
                        .blocking_show();
                    Err(error)
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            native_transparency, native_frost_supported, native_frost, native_frost_active, load_snapshot, save_task, delete_task, save_settings,
            save_mark, reorder_tasks, export_backup, read_backup, import_backup
        ])
        .run(tauri::generate_context!())
        .expect("无法启动星轨日历");
}
