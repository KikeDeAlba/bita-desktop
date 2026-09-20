use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

use crate::model::LiveTimer;
use crate::panel::{self, Anchor, TrayAnchor};

pub const ID: &str = "bita";

const OPEN: &str = "open";
const QUIT: &str = "quit";

const TEMPLATE_ICON: &[u8] = include_bytes!("../icons/trayTemplate@2x.png");

const MAX_LABEL_CHARS: usize = 12;

const UNNAMED: &str = "sin nombre";

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, OPEN, "Abrir bita", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT, "Salir de bita", true, Some("Cmd+Q"))?;
    let menu = Menu::with_items(app, &[&open, &PredefinedMenuItem::separator(app)?, &quit])?;

    TrayIconBuilder::with_id(ID)
        .icon(Image::from_bytes(TEMPLATE_ICON)?)
        .icon_as_template(true)
        .tooltip("bita — clic para abrir, clic derecho para salir")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            QUIT => app.exit(0),
            OPEN => panel::toggle(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            let app = tray.app_handle();
            remember(app, &event);
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                panel::toggle(app);
            }
        })
        .build(app)?;

    Ok(())
}

fn remember(app: &AppHandle, event: &TrayIconEvent) {
    let rect = match event {
        TrayIconEvent::Click { rect, .. }
        | TrayIconEvent::DoubleClick { rect, .. }
        | TrayIconEvent::Enter { rect, .. }
        | TrayIconEvent::Move { rect, .. }
        | TrayIconEvent::Leave { rect, .. } => rect,
        _ => return,
    };

    let scale = app
        .get_webview_window(panel::LABEL)
        .and_then(|window| window.scale_factor().ok())
        .unwrap_or(1.0);

    let position = rect.position.to_physical::<f64>(scale);
    let size = rect.size.to_physical::<f64>(scale);

    app.state::<TrayAnchor>().remember(Anchor {
        center_x: position.x + size.width / 2.0,
        bottom_y: position.y + size.height,
    });
}

pub fn set_title(app: &AppHandle, title: &str) {
    if let Some(tray) = app.tray_by_id(ID) {
        let _ = tray.set_title(if title.is_empty() { None } else { Some(title) });
    }
}

pub fn format_title(running: &[LiveTimer]) -> String {
    let Some(leader) = running.iter().min_by(|left, right| {
        left.started_at
            .cmp(&right.started_at)
            .then(left.id.cmp(&right.id))
    }) else {
        return String::new();
    };

    let clock = format_clock(leader.elapsed_seconds);

    if running.len() > 1 {
        return format!("{clock} +{}", running.len() - 1);
    }

    match label(leader) {
        Some(text) => format!("{clock} {text}"),
        None => clock,
    }
}

fn label(timer: &LiveTimer) -> Option<String> {
    if let Some(project) = timer.project_name.as_deref() {
        return Some(truncate(project, MAX_LABEL_CHARS));
    }
    if timer.draft {
        return Some(UNNAMED.to_string());
    }
    None
}

fn format_clock(seconds: i64) -> String {
    let minutes = seconds.max(0) / 60;
    format!("{}:{:02}", minutes / 60, minutes % 60)
}

fn truncate(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }
    let kept: String = text.chars().take(limit.saturating_sub(1)).collect();
    format!("{}\u{2026}", kept.trim_end())
}

#[cfg(test)]
mod tests {
    use super::{format_clock, format_title, truncate};
    use crate::model::LiveTimer;

    fn timer(
        id: i64,
        started_at: &str,
        elapsed: i64,
        project: Option<&str>,
        draft: bool,
    ) -> LiveTimer {
        LiveTimer {
            id,
            title: if draft { None } else { Some("Algo".into()) },
            doc_rel_path: None,
            sections_written: None,
            sections_total: None,
            touched_since_note: None,
            project_name: project.map(str::to_string),
            project_id: project.map(|_| 1),
            started_at: started_at.into(),
            start_local: started_at.into(),
            elapsed_seconds: elapsed,
            draft,
        }
    }

    #[test]
    fn nothing_running_shows_no_title() {
        assert_eq!(format_title(&[]), "");
    }

    #[test]
    fn one_timer_shows_the_clock_and_its_project() {
        let running = vec![timer(733, "2026-09-20T05:48:20Z", 3480, Some("Pharma STI"), false)];
        assert_eq!(format_title(&running), "0:58 Pharma STI");
    }

    #[test]
    fn a_draft_without_a_project_asks_to_be_named() {
        let running = vec![timer(734, "2026-09-20T06:42:46Z", 198, None, true)];
        assert_eq!(format_title(&running), "0:03 sin nombre");
    }

    #[test]
    fn a_named_timer_without_a_project_shows_only_the_clock() {
        let running = vec![timer(735, "2026-09-20T04:00:00Z", 7200, None, false)];
        assert_eq!(format_title(&running), "2:00");
    }

    #[test]
    fn several_timers_count_the_rest_behind_the_oldest() {
        let running = vec![
            timer(734, "2026-09-20T06:42:46Z", 198, None, true),
            timer(733, "2026-09-20T05:48:20Z", 3480, Some("Pharma STI"), false),
        ];
        assert_eq!(format_title(&running), "0:58 +1");
    }

    #[test]
    fn a_long_project_name_is_cut_so_the_menu_bar_stays_put() {
        let running = vec![timer(
            1,
            "2026-09-20T05:00:00Z",
            60,
            Some("Plataforma de Reservas"),
            false,
        )];
        assert_eq!(format_title(&running), "0:01 Plataforma\u{2026}");
    }

    #[test]
    fn the_clock_counts_whole_minutes_only() {
        assert_eq!(format_clock(0), "0:00");
        assert_eq!(format_clock(59), "0:00");
        assert_eq!(format_clock(60), "0:01");
        assert_eq!(format_clock(3599), "0:59");
        assert_eq!(format_clock(3600), "1:00");
        assert_eq!(format_clock(36_000), "10:00");
    }

    #[test]
    fn truncation_keeps_short_names_whole() {
        assert_eq!(truncate("bita", 12), "bita");
        assert_eq!(truncate("Pharma STI", 12), "Pharma STI");
    }
}
