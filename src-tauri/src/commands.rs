use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::cli::Source;
use crate::doctor::{self, Report};
use crate::model::{Problem, Scope, SummaryData, SummaryMeta, SummaryView, Snapshot};
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

async fn summary_view(app: &AppHandle, args: &[&str]) -> Result<SummaryView, Problem> {
    let cli = app.state::<AppState>().require_cli(app).await?;
    let (data, meta) = cli.call_with_meta::<SummaryData>(args).await?;
    let meta: SummaryMeta = serde_json::from_value(meta).unwrap_or_default();
    let estimate_seconds = data.groups.iter().map(|group| group.estimate_seconds).sum();

    Ok(SummaryView {
        total_seconds: data.total_seconds,
        total_human: data.total_human,
        estimate_seconds,
        groups: data.groups,
        overlaps: meta.overlaps,
        excluded: meta.excluded,
    })
}

#[tauri::command]
pub async fn worked(app: AppHandle, range: String) -> Result<SummaryView, Problem> {
    let range = match range.as_str() {
        "week" => "week",
        _ => "today",
    };
    summary_view(&app, &["summary", range, "--include-running"]).await
}

#[tauri::command]
pub async fn pending(app: AppHandle) -> Result<SummaryView, Problem> {
    summary_view(&app, &["summary", "--pending"]).await
}

#[tauri::command]
pub async fn scopes(app: AppHandle) -> Result<Vec<Scope>, Problem> {
    let cli = app.state::<AppState>().require_cli(&app).await?;
    cli.call(&["scope", "list"]).await
}

#[tauri::command]
pub async fn add_project(app: AppHandle, name: String) -> Result<Vec<Project>, Problem> {
    let cli = app.state::<AppState>().require_cli(&app).await?;
    cli.run(&["project", "add", name.trim()]).await?;
    cli.call(&["projects"]).await
}

#[tauri::command]
pub async fn set_scope(app: AppHandle, prefix: String, project: String) -> Result<Vec<Scope>, Problem> {
    let cli = app.state::<AppState>().require_cli(&app).await?;
    cli.run(&["scope", "set", prefix.trim(), project.trim()]).await?;
    cli.call(&["scope", "list"]).await
}

#[tauri::command]
pub async fn unset_scope(app: AppHandle, prefix: String) -> Result<Vec<Scope>, Problem> {
    let cli = app.state::<AppState>().require_cli(&app).await?;
    cli.run(&["scope", "unset", prefix.trim()]).await?;
    cli.call(&["scope", "list"]).await
}

#[tauri::command]
pub async fn doctor_report(app: AppHandle) -> Result<Report, Problem> {
    Ok(doctor::report(&app).await)
}

#[tauri::command]
pub async fn install_cli(app: AppHandle) -> Result<String, Problem> {
    let log = doctor::install(&app).await?;
    app.state::<AppState>().forget_cli();
    let state = app.state::<AppState>();
    state.refresh(&app).await;
    Ok(log)
}

#[tauri::command]
pub fn quit(app: AppHandle) {
    app.exit(0);
}
