use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::cli::CallOptions;
use crate::model::{Problem, ProblemKind};
use crate::notes_cmd::payload_with;

pub const ATLASSIAN_CLI: &str = "0.15.0";
pub const SYNCED_EVENT: &str = "bita://confluence-synced";

const QUICK_SECONDS: u64 = 30;
pub const SYNC_SECONDS: u64 = 120;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AtlassianSettings {
    #[serde(default)]
    pub site: Option<String>,
    #[serde(default)]
    pub via: Option<String>,
    #[serde(default)]
    pub confluence: Option<String>,
    #[serde(default)]
    pub pull: Option<bool>,
    #[serde(default)]
    pub push: Option<bool>,
}

pub fn too_old() -> Problem {
    Problem::new(
        ProblemKind::CliTooOld,
        format!("El CLI de bita es anterior a la {ATLASSIAN_CLI} y no conoce esta función."),
    )
    .with_hint(Some(
        "Actualízalo desde Ajustes. Si lo tienes enlazado a un clon, actualiza ese clon.".into(),
    ))
}

pub(crate) fn stale(problem: Problem) -> Problem {
    let message = &problem.message;
    let unknown = problem.kind == ProblemKind::CliTooOld
        || message.contains("Unknown command")
        || message.contains("Unknown option")
        || message.contains("Usage: bita confluence")
        || message.contains("Usage: bita project");
    if unknown {
        return too_old();
    }
    problem
}

async fn data(app: &AppHandle, args: &[&str], options: CallOptions) -> Result<Value, Problem> {
    payload_with(app, args, options)
        .await
        .map(|payload| payload.data)
        .map_err(stale)
}

fn quick() -> CallOptions {
    CallOptions::timeout(QUICK_SECONDS)
}

fn site_arg(site: &str) -> Result<&str, Problem> {
    let trimmed = site.trim();
    if trimmed.is_empty() || trimmed.starts_with('-') {
        return Err(Problem::new(ProblemKind::CliFailed, "Falta el sitio de Atlassian."));
    }
    Ok(trimmed)
}

pub(crate) fn on_off(value: bool) -> &'static str {
    if value {
        "on"
    } else {
        "off"
    }
}

pub(crate) fn as_list(value: Value) -> Vec<Value> {
    match value {
        Value::Array(items) => items,
        Value::Null => Vec::new(),
        other => vec![other],
    }
}

#[tauri::command]
pub async fn atlassian_sites(app: AppHandle, check: bool) -> Result<Vec<Value>, Problem> {
    let mut args = vec!["atlassian", "site", "ls"];
    if check {
        args.push("--check");
    }
    let options = if check { CallOptions::timeout(60) } else { quick() };
    data(&app, &args, options).await.map(as_list)
}

pub(crate) fn add_site_args<'a>(site: &'a str, email: &'a str) -> Vec<&'a str> {
    vec!["atlassian", "site", "add", "--site", site, "--email", email, "--token-stdin"]
}

#[tauri::command]
pub async fn atlassian_site_add(
    app: AppHandle,
    site: String,
    email: String,
    token: String,
) -> Result<Value, Problem> {
    let site = site_arg(&site)?;
    let email = email.trim();
    if email.is_empty() || email.starts_with('-') {
        return Err(Problem::new(ProblemKind::CliFailed, "Falta el correo de la cuenta."));
    }
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err(Problem::new(ProblemKind::CliFailed, "Falta el token de la API."));
    }
    data(&app, &add_site_args(site, email), CallOptions::timeout(60).with_stdin(token)).await
}

#[tauri::command]
pub async fn atlassian_site_test(app: AppHandle, site: String) -> Result<Value, Problem> {
    let site = site_arg(&site)?;
    data(&app, &["atlassian", "site", "test", site], CallOptions::timeout(60)).await
}

#[tauri::command]
pub async fn atlassian_site_remove(app: AppHandle, site: String) -> Result<(), Problem> {
    let site = site_arg(&site)?;
    data(&app, &["atlassian", "site", "rm", site], quick()).await.map(|_| ())
}

pub(crate) fn project_args(project: &str, settings: &AtlassianSettings) -> Vec<String> {
    let mut args: Vec<String> = vec!["project".into(), "atlassian".into(), project.into()];
    if let Some(site) = settings.site.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        args.push("--site".into());
        args.push(site.into());
    }
    if let Some(via) = settings.via.as_deref().filter(|value| matches!(*value, "mcp" | "cli")) {
        args.push("--via".into());
        args.push(via.into());
    }
    if let Some(reference) = settings.confluence.as_deref() {
        let reference = reference.trim();
        args.push("--confluence".into());
        args.push(if reference.is_empty() { "none".into() } else { reference.into() });
    }
    if let Some(pull) = settings.pull {
        args.push("--pull".into());
        args.push(on_off(pull).into());
    }
    if let Some(push) = settings.push {
        args.push("--push".into());
        args.push(on_off(push).into());
    }
    args
}

#[tauri::command]
pub async fn project_atlassian(
    app: AppHandle,
    project: String,
    settings: AtlassianSettings,
) -> Result<Value, Problem> {
    let project = site_arg(&project)?.to_string();
    let args = project_args(&project, &settings);
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let value = data(&app, &refs, quick()).await?;
    crate::notes::mark_stale(&app);
    Ok(value.get("atlassian").cloned().unwrap_or(value))
}

pub(crate) fn sync_args(project: Option<&str>) -> Vec<&str> {
    match project.map(str::trim).filter(|value| !value.is_empty()) {
        Some(project) => vec!["confluence", "sync", project],
        None => vec!["confluence", "sync", "--all"],
    }
}

pub async fn run_sync(app: &AppHandle, project: Option<&str>) -> Result<Vec<Value>, Problem> {
    let value = data(app, &sync_args(project), CallOptions::timeout(SYNC_SECONDS)).await?;
    crate::notes::mark_stale(app);
    let _ = app.emit(SYNCED_EVENT, ());
    Ok(as_list(value))
}

#[tauri::command]
pub async fn confluence_sync(app: AppHandle, project: Option<String>) -> Result<Vec<Value>, Problem> {
    run_sync(&app, project.as_deref()).await
}

#[tauri::command]
pub async fn confluence_sync_status(app: AppHandle, project: String) -> Result<Vec<Value>, Problem> {
    let project = site_arg(&project)?.to_string();
    data(&app, &["confluence", "sync", "status", &project], CallOptions::timeout(60))
        .await
        .map(as_list)
}

#[tauri::command]
pub async fn confluence_resolve(app: AppHandle, page_id: i64, keep: String) -> Result<(), Problem> {
    let keep = match keep.as_str() {
        "local" => "local",
        "remote" => "remote",
        other => {
            return Err(Problem::new(
                ProblemKind::CliFailed,
                format!("No sé quedarme con «{other}»."),
            ))
        }
    };
    let id = page_id.to_string();
    data(
        &app,
        &["confluence", "conflict", "resolve", &id, "--keep", keep],
        CallOptions::timeout(SYNC_SECONDS),
    )
    .await?;
    crate::notes::mark_stale(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{add_site_args, as_list, on_off, project_args, stale, sync_args, AtlassianSettings};
    use crate::model::{Problem, ProblemKind};
    use serde_json::json;

    #[test]
    fn switches_travel_as_on_and_off() {
        assert_eq!(on_off(true), "on");
        assert_eq!(on_off(false), "off");
    }

    #[test]
    fn only_the_settings_given_reach_the_cli() {
        let settings = AtlassianSettings {
            site: Some("https://acme.atlassian.net".into()),
            via: Some("cli".into()),
            confluence: Some(String::new()),
            pull: Some(true),
            push: Some(false),
        };
        assert_eq!(
            project_args("codi", &settings),
            vec![
                "project", "atlassian", "codi", "--site", "https://acme.atlassian.net", "--via", "cli",
                "--confluence", "none", "--pull", "on", "--push", "off"
            ]
        );
        assert_eq!(project_args("codi", &AtlassianSettings::default()), vec!["project", "atlassian", "codi"]);
        let odd = AtlassianSettings { via: Some("smoke".into()), ..AtlassianSettings::default() };
        assert_eq!(project_args("codi", &odd), vec!["project", "atlassian", "codi"]);
    }

    #[test]
    fn the_token_never_travels_in_the_arguments() {
        let args = add_site_args("https://acme.atlassian.net", "me@acme.com");
        assert!(args.contains(&"--token-stdin"));
        assert!(!args.iter().any(|arg| arg.contains("secret")));
        assert_eq!(args.len(), 8);
    }

    #[test]
    fn a_sync_covers_one_project_or_all() {
        assert_eq!(sync_args(Some("codi")), vec!["confluence", "sync", "codi"]);
        assert_eq!(sync_args(None), vec!["confluence", "sync", "--all"]);
        assert_eq!(sync_args(Some(" ")), vec!["confluence", "sync", "--all"]);
    }

    #[test]
    fn a_single_result_reads_as_a_list() {
        assert_eq!(as_list(json!({"project": "codi"})).len(), 1);
        assert_eq!(as_list(json!([1, 2])).len(), 2);
        assert!(as_list(json!(null)).is_empty());
    }

    #[test]
    fn an_unknown_command_names_the_version_that_has_it() {
        let mapped = stale(Problem::new(ProblemKind::CliFailed, "Unknown command \"atlassian\". (USAGE_ERROR)"));
        assert_eq!(mapped.kind, ProblemKind::CliTooOld);
        assert!(mapped.message.contains("0.15.0"));
        let kept = stale(Problem::new(ProblemKind::CliFailed, "No project codi. (USAGE_ERROR)"));
        assert_eq!(kept.kind, ProblemKind::CliFailed);
    }
}
