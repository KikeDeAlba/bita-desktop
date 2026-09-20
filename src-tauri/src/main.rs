mod cli;
mod commands;
mod doctor;
mod menu;
mod model;
mod notes;
mod notes_cmd;
mod panel;
mod pasteboard;
mod screen;
mod state;
mod tray;
mod watch;

use std::time::Duration;

use chrono::Utc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::time::{interval, MissedTickBehavior};

use panel::TrayAnchor;
use state::AppState;

const TICK: Duration = Duration::from_secs(1);
const REFRESH: Duration = Duration::from_secs(30);
const SNAPSHOT_EVENT: &str = "bita://snapshot";

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            panel::toggle(app);
        }))
        .manage(AppState::new())
        .manage(TrayAnchor::default())
        .manage(notes::NotesFocus::default())
        .invoke_handler(tauri::generate_handler![
            commands::snapshot,
            commands::refresh,
            commands::cli_info,
            commands::projects,
            commands::start_timer,
            commands::stop_timer,
            commands::discard_timer,
            commands::amend_timer,
            commands::worked,
            commands::pending,
            commands::scopes,
            commands::add_project,
            commands::set_scope,
            commands::unset_scope,
            commands::doctor_report,
            commands::install_cli,
            commands::open_notes,
            commands::notes_take_focus,
            notes_cmd::notes_tree,
            notes_cmd::notes_list,
            notes_cmd::notes_today,
            notes_cmd::notes_document,
            notes_cmd::notes_search,
            notes_cmd::notes_migrate,
            notes_cmd::open_document,
            notes_cmd::open_external,
            notes_cmd::copy_text,
            commands::quit
        ])
        .setup(|app| {
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            menu::create(app.handle())?;
            tray::create(app.handle())?;
            panel::wire(app.handle());
            watch::spawn(app.handle().clone(), cli::database_path());
            watch::spawn_docs(app.handle().clone(), cli::docs_root());
            spawn_refresh(app.handle().clone());
            spawn_tick(app.handle().clone());
            if notes::opens_on_start() {
                notes::open(app.handle(), None)?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start bita-desktop");
}

fn spawn_refresh(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = interval(REFRESH);
        ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
        loop {
            ticker.tick().await;
            let state = app.state::<AppState>();
            state.refresh(&app).await;
        }
    });
}

fn spawn_tick(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = interval(TICK);
        ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
        let mut shown_title = String::new();
        loop {
            ticker.tick().await;
            let snapshot = app.state::<AppState>().snapshot(Utc::now());
            let title = tray::format_title(&snapshot.running);
            if title != shown_title {
                tray::set_title(&app, &title);
                shown_title = title;
            }
            if panel::is_visible(&app) {
                let _ = app.emit(SNAPSHOT_EVENT, &snapshot);
            }
        }
    });
}
