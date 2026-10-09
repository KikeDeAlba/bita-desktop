use tauri::{AppHandle, Manager};

const KEEP_ACCESSORY_ENV: &str = "BITA_KEEP_ACCESSORY";

pub const NORMAL_WINDOWS: [&str; 2] = [crate::notes::LABEL, crate::live_wide::LABEL];

pub fn wants_regular(windows: &[(&str, bool)], hiding: Option<&str>) -> bool {
    windows
        .iter()
        .any(|(label, visible)| *visible && Some(*label) != hiding)
}

fn visible(app: &AppHandle, label: &str) -> bool {
    app.get_webview_window(label)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

pub fn showing(app: &AppHandle) {
    apply(app, true);
}

pub fn hiding(app: &AppHandle, label: &str) {
    let windows: Vec<(&str, bool)> = NORMAL_WINDOWS
        .iter()
        .map(|candidate| (*candidate, visible(app, candidate)))
        .collect();
    apply(app, wants_regular(&windows, Some(label)));
}

#[cfg(target_os = "macos")]
fn apply(app: &AppHandle, regular: bool) {
    if std::env::var_os(KEEP_ACCESSORY_ENV).is_some() {
        return;
    }
    let policy = if regular {
        tauri::ActivationPolicy::Regular
    } else {
        tauri::ActivationPolicy::Accessory
    };
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let _ = handle.set_activation_policy(policy);
    });
}

#[cfg(not(target_os = "macos"))]
fn apply(_app: &AppHandle, _regular: bool) {}

#[cfg(test)]
mod tests {
    use super::wants_regular;

    #[test]
    fn no_visible_window_keeps_the_app_out_of_the_dock() {
        assert!(!wants_regular(&[("notas", false), ("live-wide", false)], None));
    }

    #[test]
    fn any_visible_normal_window_puts_the_app_in_the_dock() {
        assert!(wants_regular(&[("notas", true), ("live-wide", false)], None));
        assert!(wants_regular(&[("notas", false), ("live-wide", true)], None));
    }

    #[test]
    fn the_window_being_hidden_does_not_count() {
        assert!(!wants_regular(&[("notas", true), ("live-wide", false)], Some("notas")));
        assert!(wants_regular(&[("notas", true), ("live-wide", true)], Some("notas")));
        assert!(wants_regular(&[("notas", true), ("live-wide", true)], Some("live-wide")));
    }
}
