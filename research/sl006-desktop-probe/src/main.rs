#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Read-only reuse of the existing composition implementation; never launches the app.
#[path = "../../../src-tauri/src/material.rs"]
mod material;

use serde_json::{json, Value};
use tauri::Manager;
use windows::Win32::Foundation::HWND;

// Only this process's probe HWND is ever mutated. No Shell parenting/messages/hooks.
#[link(name = "user32")]
extern "system" {
    fn SetWindowPos(h: HWND, after: HWND, x: i32, y: i32, w: i32, hgt: i32, flags: u32) -> i32;
    fn GetTopWindow(h: HWND) -> HWND;
    fn GetWindow(h: HWND, command: u32) -> HWND;
    fn GetForegroundWindow() -> HWND;
    fn GetWindowLongPtrW(h: HWND, index: i32) -> isize;
    fn IsWindowVisible(h: HWND) -> i32;
    fn IsIconic(h: HWND) -> i32;
    fn GetParent(h: HWND) -> HWND;
}

fn probe(app: &tauri::AppHandle) -> tauri::WebviewWindow {
    app.get_webview_window("probe").expect("probe window")
}

fn set_mode(app: &tauri::AppHandle, value: &str) -> Result<(), String> {
    let window = probe(app);
    if !["normal", "bottom", "top", "once"].contains(&value) {
        return Err("unknown mode".into());
    }
    // Explicit mutual exclusion: do not trust contradictory Tao flags.
    window
        .set_always_on_bottom(false)
        .map_err(|e| e.to_string())?;
    window.set_always_on_top(false).map_err(|e| e.to_string())?;
    match value {
        "bottom" => window
            .set_always_on_bottom(true)
            .map_err(|e| e.to_string())?,
        "top" => window.set_always_on_top(true).map_err(|e| e.to_string())?,
        "once" => {
            let hwnd = window.hwnd().map_err(|e| e.to_string())?;
            // SAFETY: own live HWND, HWND_BOTTOM, no move/size/activation.
            if unsafe { SetWindowPos(hwnd, HWND(1 as _), 0, 0, 0, 0, 0x13) } == 0 {
                return Err(std::io::Error::last_os_error().to_string());
            }
        }
        _ => {
            window.unminimize().map_err(|e| e.to_string())?;
            window.show().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn mode(app: tauri::AppHandle, value: String) -> Result<(), String> {
    set_mode(&app, &value)?;
    if value == "normal" {
        // Explicit user recovery may focus; the watchdog uses set_mode directly.
        let window = probe(&app);
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        // SetFocus on an already-foreground bottom window need not raise it.
        // This is one explicit recovery action, not recurring Z-order enforcement.
        if unsafe { SetWindowPos(hwnd, HWND::default(), 0, 0, 0, 0, 0x13) } == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn snapshot(app: tauri::AppHandle) -> Result<Value, String> {
    let window = probe(&app);
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    let cover = app.get_webview_window("cover").unwrap().hwnd().unwrap();
    // SAFETY: read-only live window handles. Never records other titles or text.
    unsafe {
        let mut cursor = GetTopWindow(HWND::default());
        let (mut rank, mut probe_rank, mut cover_rank) = (0, None, None);
        while !cursor.is_invalid() && rank < 10000 {
            if cursor == hwnd {
                probe_rank = Some(rank);
            }
            if cursor == cover {
                cover_rank = Some(rank);
            }
            cursor = GetWindow(cursor, 2); // GW_HWNDNEXT
            rank += 1;
        }
        let position = window.outer_position().map_err(|e| e.to_string())?;
        let size = window.outer_size().map_err(|e| e.to_string())?;
        Ok(json!({
            "probe": hwnd.0 as usize, "cover": cover.0 as usize,
            "foregroundProbe": GetForegroundWindow() == hwnd,
            "foregroundCover": GetForegroundWindow() == cover,
            "probeRank": probe_rank, "coverRank": cover_rank,
            "topmost": GetWindowLongPtrW(hwnd, -20) & 8 != 0,
            "visible": IsWindowVisible(hwnd) != 0, "minimized": IsIconic(hwnd) != 0,
            "parentNull": GetParent(hwnd).is_invalid(),
            "x": position.x, "y": position.y, "width": size.width, "height": size.height,
            "scale": window.scale_factor().map_err(|e| e.to_string())?
        }))
    }
}

#[tauri::command]
async fn frost(app: tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    let window = probe(&app);
    let (send, recv) = std::sync::mpsc::channel();
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            let result = target
                .hwnd()
                .map_err(|e| e.to_string())
                .and_then(|hwnd| material::set(hwnd, enabled).map(|_| material::active()));
            let _ = send.send(result);
        })
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || recv.recv().map_err(|e| e.to_string())?)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn exit_probe(app: tauri::AppHandle) {
    app.exit(0);
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            // Independent of WebView input. At 120s restore normal; at 180s exit.
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(120));
                let _ = set_mode(&handle, "normal");
                std::thread::sleep(std::time::Duration::from_secs(60));
                handle.exit(0);
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "probe" && matches!(event, tauri::WindowEvent::Destroyed) {
                material::clear();
                window.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![mode, snapshot, frost, exit_probe])
        .run(tauri::generate_context!())
        .expect("isolated SL006 probe failed");
}
