mod cli;
mod commands;
mod model;
mod panel;
mod state;
mod tray;
mod watch;

use std::time::Duration;

use chrono::Utc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::time::{interval, MissedTickBehavior};

use state::AppState;

const TICK: Duration = Duration::from_secs(1);
const REFRESH: Duration = Duration::from_secs(30);
const SNAPSHOT_EVENT: &str = "bita://snapshot";

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_positioner::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::snapshot,
            commands::refresh,
            commands::cli_info,
            commands::projects,
            commands::start_timer,
            commands::stop_timer,
            commands::discard_timer,
            commands::amend_timer
        ])
        .setup(|app| {
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            tray::create(app.handle())?;
            panel::wire(app.handle());
            watch::spawn(app.handle().clone(), cli::database_path());
            spawn_refresh(app.handle().clone());
            spawn_tick(app.handle().clone());
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
