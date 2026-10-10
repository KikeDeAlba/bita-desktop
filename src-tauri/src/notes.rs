use std::env;
use std::sync::Mutex;

use tauri::{
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

pub const LABEL: &str = "notas";
pub const FOCUS_EVENT: &str = "bita://notes-focus";
pub const STALE_EVENT: &str = "bita://docs-changed";
pub const MEETING_EVENT: &str = "bita://notes-meeting";

const SKIP_ON_START_ENV: &str = "BITA_NO_OPEN_NOTES";
const WIDTH: f64 = 1280.0;
const HEIGHT: f64 = 820.0;
const MIN_WIDTH: f64 = 720.0;
const MIN_HEIGHT: f64 = 420.0;
const SCREEN_SHARE: f64 = 0.9;

pub fn fit(wanted: f64, available: Option<f64>, minimum: f64) -> f64 {
    match available {
        Some(space) if space > 0.0 => wanted.min(space * SCREEN_SHARE).max(minimum),
        _ => wanted,
    }
}

pub fn initial_size(app: &AppHandle, wanted: (f64, f64), minimum: (f64, f64)) -> (f64, f64) {
    let screen = app.primary_monitor().ok().flatten().map(|monitor| {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        (
            f64::from(area.size.width) / scale,
            f64::from(area.size.height) / scale,
        )
    });
    (
        fit(wanted.0, screen.map(|(width, _)| width), minimum.0),
        fit(wanted.1, screen.map(|(_, height)| height), minimum.1),
    )
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingFocus {
    pub entry_id: i64,
    pub tab: String,
}

#[derive(Default)]
pub struct NotesFocus {
    entry: Mutex<Option<i64>>,
    meeting: Mutex<Option<MeetingFocus>>,
}

impl NotesFocus {
    fn remember_meeting(&self, focus: Option<MeetingFocus>) {
        *self.meeting.lock().expect("focus poisoned") = focus;
    }

    fn take_meeting(&self) -> Option<MeetingFocus> {
        self.meeting.lock().expect("focus poisoned").take()
    }

    fn remember(&self, entry: Option<i64>) {
        *self.entry.lock().expect("focus poisoned") = entry;
    }

    fn take(&self) -> Option<i64> {
        self.entry.lock().expect("focus poisoned").take()
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

pub fn take_focus(app: &AppHandle) -> Option<i64> {
    app.state::<NotesFocus>().take()
}

pub fn take_meeting(app: &AppHandle) -> Option<MeetingFocus> {
    app.state::<NotesFocus>().take_meeting()
}

pub fn open_meeting(app: &AppHandle, focus: MeetingFocus) -> tauri::Result<()> {
    let existing = find(app);
    if let Some(window) = existing.as_ref() {
        let _ = window.emit(MEETING_EVENT, focus.clone());
        app.state::<NotesFocus>().remember_meeting(None);
    } else {
        app.state::<NotesFocus>().remember_meeting(Some(focus));
    }
    open(app, None)
}

pub fn open(app: &AppHandle, entry_id: Option<i64>) -> tauri::Result<()> {
    app.state::<NotesFocus>().remember(entry_id);

    let window = match find(app) {
        Some(existing) => {
            if let Some(entry_id) = entry_id {
                let _ = existing.emit(FOCUS_EVENT, entry_id);
            }
            existing
        }
        None => {
            let created = build(app)?;
            wire(app, &created);
            created
        }
    };

    crate::activation::showing(app);
    window.show()?;
    window.set_focus()?;
    Ok(())
}

fn build(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let (width, height) = initial_size(app, (WIDTH, HEIGHT), (MIN_WIDTH, MIN_HEIGHT));
    let builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("notas.html".into()))
        .title("Notas · Den")
        .inner_size(width, height)
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
        .resizable(true)
        .decorations(true)
        .transparent(false)
        .always_on_top(false)
        .skip_taskbar(false)
        .center()
        .visible(false)
        .on_navigation(|url| {
            url.scheme() == "tauri" || url.host_str() == Some("localhost")
        });

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    builder.build()
}

fn wire(app: &AppHandle, window: &WebviewWindow) {
    let target = window.clone();
    let handle = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            crate::activation::hiding(&handle, LABEL);
            let _ = target.hide();
        }
    });
}

pub fn opens_on_start() -> bool {
    env::var_os(SKIP_ON_START_ENV).is_none()
}

pub fn mark_stale(app: &AppHandle) {
    if is_visible(app) || crate::panel::is_visible(app) {
        let _ = app.emit(STALE_EVENT, ());
    }
}

#[cfg(test)]
mod tests {
    use super::fit;

    #[test]
    fn a_large_screen_gets_the_full_size() {
        assert_eq!(fit(1280.0, Some(1728.0), 720.0), 1280.0);
    }

    #[test]
    fn a_small_screen_caps_the_window_at_most_of_it() {
        assert_eq!(fit(1280.0, Some(1280.0), 720.0), 1152.0);
    }

    #[test]
    fn the_minimum_still_holds_on_a_tiny_screen() {
        assert_eq!(fit(1280.0, Some(600.0), 720.0), 720.0);
    }

    #[test]
    fn without_a_monitor_the_wanted_size_stands() {
        assert_eq!(fit(1280.0, None, 720.0), 1280.0);
    }
}
