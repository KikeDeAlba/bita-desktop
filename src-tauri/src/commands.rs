use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::cli::Source;
use crate::model::{Problem, Snapshot};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInfo {
    pub node: String,
    pub entry: String,
    pub database: String,
    pub bundled: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub active: bool,
    #[serde(default)]
    pub client_name: Option<String>,
    #[serde(default)]
    pub jira_project_key: Option<String>,
}

#[tauri::command]
pub fn snapshot(state: State<'_, AppState>) -> Snapshot {
    state.snapshot(Utc::now())
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

#[tauri::command]
pub async fn refresh(app: AppHandle) -> Result<Snapshot, Problem> {
    let state = app.state::<AppState>();
    state.refresh(&app).await;
    Ok(state.snapshot(Utc::now()))
}

#[tauri::command]
pub async fn projects(app: AppHandle) -> Result<Vec<Project>, Problem> {
    let cli = app.state::<AppState>().require_cli(&app).await?;
    cli.call(&["projects"]).await
}

#[tauri::command]
pub async fn start_timer(
    app: AppHandle,
    title: Option<String>,
    project: Option<String>,
) -> Result<Snapshot, Problem> {
    let mut args: Vec<String> = vec!["start".into()];
    if let Some(title) = title.as_ref().map(|value| value.trim()) {
        if !title.is_empty() {
            args.push(title.to_string());
        }
    }
    if let Some(project) = project {
        args.push("--project".into());
        args.push(project);
    }
    act(app, args).await
}

#[tauri::command]
pub async fn stop_timer(app: AppHandle, id: i64) -> Result<Snapshot, Problem> {
    act(app, vec!["stop".into(), id.to_string()]).await
}

#[tauri::command]
pub async fn discard_timer(app: AppHandle, id: i64) -> Result<Snapshot, Problem> {
    act(app, vec!["cancel".into(), id.to_string()]).await
}

#[tauri::command]
pub async fn amend_timer(
    app: AppHandle,
    id: i64,
    title: Option<String>,
    project: Option<String>,
) -> Result<Snapshot, Problem> {
    let mut args: Vec<String> = vec!["amend".into(), id.to_string()];
    if let Some(title) = title.as_ref().map(|value| value.trim()) {
        if !title.is_empty() {
            args.push("--title".into());
            args.push(title.to_string());
        }
    }
    if let Some(project) = project {
        args.push("--project".into());
        args.push(project);
    }
    act(app, args).await
}

async fn act(app: AppHandle, args: Vec<String>) -> Result<Snapshot, Problem> {
    let state = app.state::<AppState>();
    let cli = state.require_cli(&app).await?;
    let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
    cli.run(&borrowed).await?;
    state.refresh(&app).await;
    Ok(state.snapshot(Utc::now()))
}
