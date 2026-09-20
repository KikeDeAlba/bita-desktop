use std::env;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, PhysicalPosition, WebviewWindow, WindowEvent};

use crate::state::AppState;

pub const LABEL: &str = "panel";

const KEEP_OPEN_ENV: &str = "BITA_KEEP_PANEL";

const GAP: f64 = 6.0;
const EDGE_MARGIN: f64 = 8.0;
const FALLBACK_MENU_BAR: f64 = 24.0;

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
    let Ok(size) = window.outer_size() else {
        return;
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let width = f64::from(size.width);

    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());

    let (screen_x, screen_y, screen_width) = match monitor.as_ref() {
        Some(monitor) => (
            f64::from(monitor.position().x),
            f64::from(monitor.position().y),
            f64::from(monitor.size().width),
        ),
        None => (0.0, 0.0, width),
    };

    let menu_bar = crate::screen::menu_bar_height().unwrap_or(FALLBACK_MENU_BAR);
    let y = screen_y + (menu_bar + GAP) * scale;

    let left = screen_x + EDGE_MARGIN * scale;
    let right = (screen_x + screen_width - width - EDGE_MARGIN * scale).max(left);
    let x = match app.state::<TrayAnchor>().recall() {
        Some(anchor) => (anchor.center_x - width / 2.0).clamp(left, right),
        None => right,
    };

    let _ = window.set_position(PhysicalPosition::new(x, y));
}

pub fn wire(app: &AppHandle) {
    let Some(window) = find(app) else {
        return;
    };
    let hides_on_blur = env::var_os(KEEP_OPEN_ENV).is_none();
    if !hides_on_blur {
        show(app, &window);
    }
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
