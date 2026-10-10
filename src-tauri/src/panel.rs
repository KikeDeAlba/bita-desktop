use std::env;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, PhysicalPosition, WebviewWindow, WindowEvent};

use crate::state::AppState;

pub const LABEL: &str = "panel";

const KEEP_OPEN_ENV: &str = "BITA_KEEP_PANEL";

const GAP: f64 = 6.0;
const EDGE_MARGIN: f64 = 8.0;
#[cfg(target_os = "macos")]
const FALLBACK_MENU_BAR: f64 = 24.0;

#[derive(Default)]
pub struct TrayAnchor {
    spot: Mutex<Option<Anchor>>,
}

#[derive(Debug, Clone, Copy)]
pub struct Anchor {
    pub center_x: f64,
    pub top_y: f64,
    pub bottom_y: f64,
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Area {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Edge {
    Top,
    Bottom,
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

#[cfg(target_os = "macos")]
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

#[cfg(not(target_os = "macos"))]
fn place(app: &AppHandle, window: &WebviewWindow) {
    let Ok(size) = window.outer_size() else {
        return;
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let panel = (f64::from(size.width), f64::from(size.height));

    let anchor = tray_anchor(app, scale).or_else(|| app.state::<TrayAnchor>().recall());

    let monitor = anchor
        .and_then(|spot| window.monitor_from_point(spot.center_x, spot.top_y).ok().flatten())
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten());

    let area = match monitor.as_ref() {
        Some(monitor) => {
            let work = monitor.work_area();
            Area {
                x: f64::from(work.position.x),
                y: f64::from(work.position.y),
                width: f64::from(work.size.width),
                height: f64::from(work.size.height),
            }
        }
        None => Area { x: 0.0, y: 0.0, width: panel.0, height: panel.1 },
    };

    let fallback = if cfg!(windows) { Edge::Bottom } else { Edge::Top };
    let (x, y) = position_near_tray(area, panel, anchor, scale, fallback);
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

#[cfg(not(target_os = "macos"))]
fn tray_anchor(app: &AppHandle, scale: f64) -> Option<Anchor> {
    let rect = app.tray_by_id(crate::tray::ID)?.rect().ok()??;
    let position = rect.position.to_physical::<f64>(scale);
    let size = rect.size.to_physical::<f64>(scale);
    if size.width <= 0.0 && size.height <= 0.0 {
        return None;
    }
    Some(Anchor {
        center_x: position.x + size.width / 2.0,
        top_y: position.y,
        bottom_y: position.y + size.height,
    })
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
pub fn position_near_tray(area: Area, panel: (f64, f64), anchor: Option<Anchor>, scale: f64, fallback: Edge) -> (f64, f64) {
    let (width, height) = panel;
    let gap = GAP * scale;
    let margin = EDGE_MARGIN * scale;

    let left = area.x + margin;
    let right = (area.x + area.width - width - margin).max(left);
    let top = area.y + gap;
    let bottom = (area.y + area.height - height - gap).max(top);

    let Some(anchor) = anchor else {
        let y = match fallback {
            Edge::Top => top,
            Edge::Bottom => bottom,
        };
        return (right, y);
    };

    let x = (anchor.center_x - width / 2.0).clamp(left, right);
    let middle = area.y + area.height / 2.0;
    let y = if (anchor.top_y + anchor.bottom_y) / 2.0 > middle {
        anchor.top_y - height - gap
    } else {
        anchor.bottom_y + gap
    };
    (x, y.clamp(top, bottom))
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

#[cfg(test)]
mod tests {
    use super::{position_near_tray, Anchor, Area, Edge};

    const SCREEN: Area = Area { x: 0.0, y: 0.0, width: 1920.0, height: 1040.0 };
    const PANEL: (f64, f64) = (380.0, 520.0);

    #[test]
    fn a_bottom_taskbar_opens_the_panel_above_the_icon() {
        let anchor = Anchor { center_x: 1700.0, top_y: 1045.0, bottom_y: 1075.0 };
        let (x, y) = position_near_tray(SCREEN, PANEL, Some(anchor), 1.0, Edge::Top);
        assert_eq!(x, 1510.0);
        assert_eq!(y, 1040.0 - 520.0 - 6.0);
    }

    #[test]
    fn a_top_bar_opens_the_panel_below_the_icon() {
        let area = Area { x: 0.0, y: 32.0, width: 1920.0, height: 1048.0 };
        let anchor = Anchor { center_x: 1000.0, top_y: 0.0, bottom_y: 32.0 };
        let (x, y) = position_near_tray(area, PANEL, Some(anchor), 1.0, Edge::Bottom);
        assert_eq!(x, 810.0);
        assert_eq!(y, 38.0);
    }

    #[test]
    fn the_panel_never_leaves_the_screen_edge() {
        let anchor = Anchor { center_x: 1915.0, top_y: 1045.0, bottom_y: 1075.0 };
        let (x, _) = position_near_tray(SCREEN, PANEL, Some(anchor), 2.0, Edge::Top);
        assert_eq!(x, 1920.0 - 380.0 - 16.0);
    }

    #[test]
    fn without_an_icon_the_panel_goes_to_the_fallback_corner() {
        assert_eq!(position_near_tray(SCREEN, PANEL, None, 1.0, Edge::Bottom), (1532.0, 514.0));
        assert_eq!(position_near_tray(SCREEN, PANEL, None, 1.0, Edge::Top), (1532.0, 6.0));
    }
}
