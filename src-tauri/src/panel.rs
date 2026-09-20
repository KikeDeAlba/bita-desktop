use std::env;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, PhysicalPosition, WebviewWindow, WindowEvent};

use crate::state::AppState;

pub const LABEL: &str = "panel";

const KEEP_OPEN_ENV: &str = "BITA_KEEP_PANEL";

const GAP: f64 = 6.0;
const EDGE_MARGIN: f64 = 8.0;

#[derive(Default)]
pub struct TrayAnchor {
    spot: Mutex<Option<Anchor>>,
}

#[derive(Debug, Clone, Copy)]
pub struct Anchor {
    pub center_x: f64,
    pub bottom_y: f64,
}

impl TrayAnchor {
    pub fn remember(&self, anchor: Anchor) {
        *self.spot.lock().expect("anchor poisoned") = Some(anchor);
    }

    pub fn recall(&self) -> Option<Anchor> {
        *self.spot.lock().expect("anchor poisoned")
    }
}

pub fn find(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

pub fn is_visible(app: &AppHandle) -> bool {
    find(app)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

pub fn toggle(app: &AppHandle) {
    let Some(window) = find(app) else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }
    show(app, &window);
    refresh_soon(app.clone());
}

pub fn show(app: &AppHandle, window: &WebviewWindow) {
    place(app, window);
    let _ = window.show();
    let _ = window.set_focus();
}

fn place(app: &AppHandle, window: &WebviewWindow) {
    let Some(anchor) = app.state::<TrayAnchor>().recall() else {
        return;
    };
    let Ok(size) = window.outer_size() else {
        return;
    };
    let scale = window.scale_factor().unwrap_or(1.0);

    let mut x = anchor.center_x - f64::from(size.width) / 2.0;
    let y = anchor.bottom_y + GAP * scale;

    if let Ok(Some(monitor)) = window.current_monitor() {
        let left = f64::from(monitor.position().x) + EDGE_MARGIN * scale;
        let right = f64::from(monitor.position().x + monitor.size().width as i32)
            - f64::from(size.width)
            - EDGE_MARGIN * scale;
        x = x.clamp(left, right.max(left));
    }

    let _ = window.set_position(PhysicalPosition::new(x, y));
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

fn refresh_soon(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        app.state::<AppState>().refresh(&app).await;
    });
}
