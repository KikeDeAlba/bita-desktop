use chrono::Utc;
use tauri::{AppHandle, Manager, State};

use crate::cli::Source;
use crate::model::Snapshot;
use crate::state::AppState;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInfo {
    pub node: String,
    pub entry: String,
    pub database: String,
    pub bundled: bool,
}

#[tauri::command]
pub fn snapshot(state: State<'_, AppState>) -> Snapshot {
    state.snapshot(Utc::now())
}

#[tauri::command]
pub async fn refresh(app: AppHandle) -> Result<Snapshot, String> {
    let state = app.state::<AppState>();
    state.refresh(&app).await;
    Ok(state.snapshot(Utc::now()))
}

#[tauri::command]
pub fn cli_info(state: State<'_, AppState>) -> Option<CliInfo> {
    state.describe_cli().map(|cli| CliInfo {
        node: cli.node_path().display().to_string(),
        entry: cli.entry_path().display().to_string(),
        database: cli.database_path().display().to_string(),
        bundled: cli.source() == Source::Bundled,
    })
}
