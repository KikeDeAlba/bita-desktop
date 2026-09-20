use std::env;

use tauri::{AppHandle, Manager, WebviewWindow, WindowEvent};
use tauri_plugin_positioner::{Position, WindowExt};

pub const LABEL: &str = "panel";

const KEEP_OPEN_ENV: &str = "BITA_KEEP_PANEL";

pub fn find(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

pub fn toggle(app: &AppHandle) {
    let Some(window) = find(app) else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        show(&window);
    }
}

pub fn show(window: &WebviewWindow) {
    let _ = window.move_window_constrained(Position::TrayBottomCenter);
    let _ = window.show();
    let _ = window.set_focus();
}

pub fn wire(app: &AppHandle) {
    let Some(window) = find(app) else {
        return;
    };
    let hides_on_blur = env::var_os(KEEP_OPEN_ENV).is_none();
    let target = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Focused(false) if hides_on_blur => {
            let _ = target.hide();
        }
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = target.hide();
        }
        _ => {}
    });
}
