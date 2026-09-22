use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tokio::process::Command;

use crate::cli;
use crate::model::{Problem, ProblemKind};
use crate::state::AppState;

const OPEN: &str = "/usr/bin/open";
const MIN_CLI: &str = "0.3.0";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliPayload {
    pub data: serde_json::Value,
    pub meta: serde_json::Value,
}

async fn payload(app: &AppHandle, args: &[&str]) -> Result<CliPayload, Problem> {
    let handle = app.state::<AppState>().require_cli(app).await?;
    let (data, meta) = handle
        .call_with_meta::<serde_json::Value>(args)
        .await
        .map_err(stale_cli)?;
    Ok(CliPayload { data, meta })
}

fn stale_cli(problem: Problem) -> Problem {
    let message = if problem.message.contains("was written by a newer version") {
        "La base de datos la escribió un bita más nuevo que el CLI instalado.".to_string()
    } else if problem.message.contains("Unknown command")
        || problem.message.contains("Usage: bita docs")
    {
        format!("El CLI de bita es anterior a la {MIN_CLI} y no sabe leer documentos.")
    } else {
        return problem;
    };

    Problem::new(ProblemKind::CliTooOld, message).with_hint(Some(
        "Actualízalo desde Ajustes. Si lo tienes enlazado a un clon, actualiza ese clon.".into(),
    ))
}

#[tauri::command]
pub async fn notes_tree(app: AppHandle) -> Result<CliPayload, Problem> {
    payload(&app, &["docs", "tree", "--months"]).await
}

#[tauri::command]
pub async fn notes_list(
    app: AppHandle,
    project: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<CliPayload, Problem> {
    let limit = limit.unwrap_or(200).to_string();
    let offset = offset.unwrap_or(0).to_string();
    let mut args: Vec<&str> = vec!["docs", "ls", "--limit", &limit, "--offset", &offset];
    if let Some(project) = project.as_deref() {
        args.push("--project");
        args.push(project);
    }
    payload(&app, &args).await
}

#[tauri::command]
pub async fn notes_today(app: AppHandle) -> Result<CliPayload, Problem> {
    payload(&app, &["docs", "ls", "today", "--limit", "0"]).await
}

#[tauri::command]
pub async fn notes_document(app: AppHandle, entry_id: i64) -> Result<CliPayload, Problem> {
    let id = entry_id.to_string();
    payload(&app, &["docs", "show", &id]).await
}

#[tauri::command]
pub async fn notes_search(
    app: AppHandle,
    query: String,
    project: Option<String>,
) -> Result<CliPayload, Problem> {
    let needle = query.trim();
    if needle.is_empty() {
        return Err(Problem::new(
            ProblemKind::CliFailed,
            "La búsqueda necesita algo que buscar.",
        ));
    }

    let mut args: Vec<&str> = vec!["docs", "search", needle];
    if let Some(project) = project.as_deref() {
        args.push("--project");
        args.push(project);
    }
    payload(&app, &args).await
}

#[tauri::command]
pub async fn open_document(rel_path: String) -> Result<(), Problem> {
    let absolute = inside_docs_root(&rel_path)?;

    let opener = cli::editor_override().unwrap_or_else(|| OPEN.into());
    let status = Command::new(&opener)
        .arg(&absolute)
        .status()
        .await
        .map_err(|error| {
            Problem::new(
                ProblemKind::CliFailed,
                format!("No pude abrir {}: {error}", absolute.display()),
            )
        })?;

    if status.success() {
        return Ok(());
    }
    Err(Problem::new(
        ProblemKind::CliFailed,
        format!("El editor no quiso abrir {}.", absolute.display()),
    ))
}

#[tauri::command]
pub async fn open_external(url: String) -> Result<(), Problem> {
    let parsed = url.trim();
    let allowed = ["http://", "https://", "mailto:"]
        .iter()
        .any(|scheme| parsed.starts_with(scheme));

    if !allowed {
        return Err(Problem::new(
            ProblemKind::CliFailed,
            format!("No abro enlaces de ese tipo: {parsed}"),
        ));
    }

    Command::new(OPEN)
        .arg(parsed)
        .status()
        .await
        .map_err(|error| {
            Problem::new(ProblemKind::CliFailed, format!("No pude abrir el enlace: {error}"))
        })
        .map(|_| ())
}

#[tauri::command]
pub fn copy_text(text: String) -> Result<(), Problem> {
    if crate::pasteboard::write(&text) {
        return Ok(());
    }
    Err(Problem::new(
        ProblemKind::Unreadable,
        "No pude escribir en el portapapeles.",
    ))
}

fn doc_shaped(rel_path: &str) -> Result<&Path, &'static str> {
    let candidate = Path::new(rel_path);
    if candidate.is_absolute() {
        return Err("la ruta es absoluta");
    }
    if candidate
        .components()
        .any(|part| matches!(part, Component::ParentDir | Component::Prefix(_)))
    {
        return Err("la ruta sale del directorio");
    }
    if candidate.extension().and_then(|value| value.to_str()) != Some("md") {
        return Err("no es un .md");
    }
    Ok(candidate)
}

fn inside_docs_root(rel_path: &str) -> Result<PathBuf, Problem> {
    let refused = |reason: &str| {
        Problem::new(
            ProblemKind::CliFailed,
            format!("\"{rel_path}\" no es un documento de bita: {reason}."),
        )
    };

    let candidate = doc_shaped(rel_path).map_err(refused)?;

    let root = cli::docs_root();
    let target = root.join(candidate);

    let canonical_root = std::fs::canonicalize(&root).unwrap_or(root);
    let canonical_target = std::fs::canonicalize(&target)
        .map_err(|_| refused("el archivo no está donde dice la base"))?;

    if !canonical_target.starts_with(&canonical_root) {
        return Err(refused("la ruta sale del directorio"));
    }
    Ok(canonical_target)
}

#[cfg(test)]
mod tests {
    use super::{doc_shaped, inside_docs_root, stale_cli, MIN_CLI};
    use crate::model::{Problem, ProblemKind};

    #[test]
    fn an_unknown_command_reads_as_a_stale_cli() {
        let raw = Problem::new(
            ProblemKind::CliFailed,
            "Unknown command \"docs\". Run \"bita --help\" for the list. (USAGE_ERROR)",
        );
        let mapped = stale_cli(raw);

        assert_eq!(mapped.kind, ProblemKind::CliTooOld);
        assert!(mapped.message.contains(MIN_CLI));
        assert!(mapped.hint.is_some());
    }

    #[test]
    fn an_unknown_docs_subcommand_reads_as_a_stale_cli() {
        let raw = Problem::new(
            ProblemKind::CliFailed,
            "Usage: bita docs <tree|ls|show|search> (USAGE_ERROR)",
        );
        let mapped = stale_cli(raw);

        assert_eq!(mapped.kind, ProblemKind::CliTooOld);
        assert!(mapped.message.contains(MIN_CLI));
        assert!(mapped.hint.is_some());
    }

    #[test]
    fn a_database_from_the_future_reads_as_a_stale_cli() {
        let raw = Problem::new(
            ProblemKind::CliFailed,
            "the database at /x/bita.db was written by a newer version (schema 4, this build understands 3) (UNEXPECTED_ERROR)",
        );
        let mapped = stale_cli(raw);

        assert_eq!(mapped.kind, ProblemKind::CliTooOld);
        assert!(mapped.message.contains("base de datos"));
        assert!(mapped.hint.is_some());
    }

    #[test]
    fn any_other_failure_is_left_alone() {
        let raw = Problem::new(ProblemKind::CliFailed, "No entry #999. (USAGE_ERROR)");
        let mapped = stale_cli(raw);

        assert_eq!(mapped.kind, ProblemKind::CliFailed);
        assert_eq!(mapped.message, "No entry #999. (USAGE_ERROR)");
    }

    #[test]
    fn a_nested_page_path_keeps_its_shape() {
        assert!(doc_shaped("pharma-sti/bootstrap/credenciales-y-secretos.md").is_ok());
        assert!(doc_shaped("pharma-sti/a/b/c/d/hondo.md").is_ok());
    }

    #[test]
    fn climbing_out_from_a_nested_page_is_refused() {
        assert!(doc_shaped("pharma-sti/bootstrap/../../../etc/passwd.md").is_err());
    }

    #[test]
    fn an_absolute_path_is_refused() {
        assert!(inside_docs_root("/etc/passwd.md").is_err());
    }

    #[test]
    fn climbing_out_of_the_docs_root_is_refused() {
        assert!(inside_docs_root("../../etc/passwd.md").is_err());
        assert!(inside_docs_root("arsm/../../escape.md").is_err());
    }

    #[test]
    fn only_markdown_is_opened() {
        assert!(inside_docs_root("arsm/2026/09/20-735-cognito.txt").is_err());
        assert!(inside_docs_root("arsm/2026/09/../../../etc/hosts").is_err());
    }
}
