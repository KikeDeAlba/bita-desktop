pub mod node;

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use std::{env, fs};

use serde::de::DeserializeOwned;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};
use tokio::process::Command;
use tokio::time::timeout;

use crate::model::{CliError, Envelope, Problem, ProblemKind, SUPPORTED_SCHEMA};

const CLI_OVERRIDE_ENV: &str = "BITA_CLI";
const DB_OVERRIDE_ENV: &str = "BITA_DB_PATH";
const DOCS_OVERRIDE_ENV: &str = "BITA_DOCS_DIR";
const EDITOR_OVERRIDE_ENV: &str = "BITA_EDITOR";
const BUNDLED_ENTRY: &str = "bita/src/bin/bita.ts";
const CALL_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    Installed,
    Bundled,
}

#[derive(Debug, Clone)]
pub struct Cli {
    node: PathBuf,
    entry: PathBuf,
    source: Source,
    db_path: PathBuf,
    path_env: OsString,
}

impl Cli {
    pub async fn discover(app: &AppHandle) -> Result<Self, Problem> {
        let node = node::discover().await.ok_or_else(|| {
            Problem::new(
                ProblemKind::NodeMissing,
                format!("No encuentro Node {} o superior.", node::MIN_MAJOR),
            )
            .with_hint(Some("brew install node".into()))
        })?;

        let (entry, source) = resolve_entry(app).ok_or_else(|| {
            Problem::new(
                ProblemKind::CliMissing,
                "No encuentro el CLI de bita, ni instalado ni dentro de la app.",
            )
        })?;

        let node_dir = node
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/usr/bin"));

        Ok(Self {
            node,
            entry,
            source,
            db_path: database_path(),
            path_env: OsString::from(format!(
                "{}:/usr/bin:/bin:/usr/sbin:/sbin",
                node_dir.display()
            )),
        })
    }

    pub fn source(&self) -> Source {
        self.source
    }

    pub fn node_path(&self) -> &PathBuf {
        &self.node
    }

    pub fn entry_path(&self) -> &PathBuf {
        &self.entry
    }

    pub fn database_path(&self) -> &PathBuf {
        &self.db_path
    }

    pub async fn call<T: DeserializeOwned>(&self, args: &[&str]) -> Result<T, Problem> {
        self.envelope::<T>(args).await?.ok_or_else(|| {
            Problem::new(
                ProblemKind::Unreadable,
                "La respuesta del CLI venía sin datos.",
            )
        })
    }

    pub async fn run(&self, args: &[&str]) -> Result<(), Problem> {
        self.envelope::<serde_json::Value>(args).await.map(|_| ())
    }

    pub async fn call_with_meta<T: DeserializeOwned>(
        &self,
        args: &[&str],
    ) -> Result<(T, serde_json::Value), Problem> {
        let (data, meta) = self.envelope_with_meta::<T>(args).await?;
        let data = data.ok_or_else(|| {
            Problem::new(
                ProblemKind::Unreadable,
                "La respuesta del CLI venía sin datos.",
            )
        })?;
        Ok((data, meta))
    }

    async fn envelope<T: DeserializeOwned>(&self, args: &[&str]) -> Result<Option<T>, Problem> {
        self.envelope_with_meta::<T>(args).await.map(|(data, _)| data)
    }

    async fn envelope_with_meta<T: DeserializeOwned>(
        &self,
        args: &[&str],
    ) -> Result<(Option<T>, serde_json::Value), Problem> {
        let mut command = Command::new(&self.node);
        command
            .arg(&self.entry)
            .args(args)
            .arg("--json")
            .arg("--db-path")
            .arg(&self.db_path)
            .current_dir("/")
            .env_clear()
            .env("PATH", &self.path_env)
            .env("NO_COLOR", "1")
            .env("TERM", "dumb")
            .stdin(Stdio::null())
            .kill_on_drop(true);

        if let Some(docs) = env::var_os(DOCS_OVERRIDE_ENV) {
            command.arg("--docs-dir").arg(docs);
        }

        if let Some(home) = env::var_os("HOME") {
            command.env("HOME", home);
        }

        let output = timeout(CALL_TIMEOUT, command.output())
            .await
            .map_err(|_| {
                Problem::new(
                    ProblemKind::CliFailed,
                    format!("El CLI no respondió en {} s.", CALL_TIMEOUT.as_secs()),
                )
            })?
            .map_err(|error| {
                Problem::new(
                    ProblemKind::CliFailed,
                    format!("No pude ejecutar el CLI: {error}"),
                )
            })?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let line = stdout.trim();

        if line.is_empty() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(Problem::new(
                ProblemKind::Unreadable,
                format!("El CLI no devolvió nada: {}", stderr.trim()),
            ));
        }

        let envelope: Envelope<T> = serde_json::from_str(line).map_err(|error| {
            Problem::new(
                ProblemKind::Unreadable,
                format!("No entiendo la respuesta del CLI: {error}"),
            )
        })?;

        if envelope.schema_version != SUPPORTED_SCHEMA {
            return Err(Problem::new(
                ProblemKind::SchemaMismatch,
                format!(
                    "El CLI habla el esquema {} y esta app entiende el {}.",
                    envelope.schema_version, SUPPORTED_SCHEMA
                ),
            ));
        }

        if !envelope.ok {
            let CliError {
                code,
                message,
                hint,
            } = envelope
                .error
                .unwrap_or_else(|| CliError {
                    code: "UNKNOWN".to_string(),
                    message: "El CLI falló sin decir por qué.".to_string(),
                    hint: None,
                });
            return Err(
                Problem::new(ProblemKind::CliFailed, format!("{message} ({code})"))
                    .with_hint(hint),
            );
        }

        Ok((envelope.data, envelope.meta.unwrap_or(serde_json::Value::Null)))
    }
}

pub fn resolve_entry(app: &AppHandle) -> Option<(PathBuf, Source)> {
    if let Some(explicit) = env::var_os(CLI_OVERRIDE_ENV) {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Some((canonical(path), Source::Installed));
        }
    }

    for directory in bin_directories() {
        let candidate = directory.join("bita");
        if candidate.exists() {
            return Some((canonical(candidate), Source::Installed));
        }
    }

    let bundled = app.path().resolve(BUNDLED_ENTRY, BaseDirectory::Resource).ok()?;
    if bundled.is_file() {
        return Some((bundled, Source::Bundled));
    }

    None
}

fn bin_directories() -> Vec<PathBuf> {
    let mut directories = Vec::new();

    if let Some(pnpm_home) = env::var_os("PNPM_HOME") {
        directories.push(PathBuf::from(pnpm_home).join("bin"));
    }

    if let Some(home) = node::home() {
        directories.push(home.join("Library/pnpm/bin"));
        directories.push(home.join(".local/bin"));
        directories.push(home.join("bin"));
    }

    directories.push(PathBuf::from("/opt/homebrew/bin"));
    directories.push(PathBuf::from("/usr/local/bin"));
    directories
}

fn canonical(path: PathBuf) -> PathBuf {
    fs::canonicalize(&path).unwrap_or(path)
}

pub fn version_of(node: &Path, entry: &Path) -> Option<String> {
    let output = std::process::Command::new(node)
        .arg(entry)
        .arg("--version")
        .current_dir("/")
        .stdin(Stdio::null())
        .output()
        .ok()?;

    let text = String::from_utf8_lossy(&output.stdout);
    let first = text.lines().next()?.trim();
    if first.is_empty() {
        return None;
    }
    Some(first.to_string())
}

pub fn docs_root() -> PathBuf {
    if let Some(explicit) = env::var_os(DOCS_OVERRIDE_ENV) {
        return PathBuf::from(explicit);
    }

    let database = database_path();
    match database.parent() {
        Some(parent) => parent.join("docs"),
        None => PathBuf::from("/tmp").join("docs"),
    }
}

pub fn editor_override() -> Option<OsString> {
    env::var_os(EDITOR_OVERRIDE_ENV)
}

pub fn database_path() -> PathBuf {
    if let Some(explicit) = env::var_os(DB_OVERRIDE_ENV) {
        return PathBuf::from(explicit);
    }

    let data_home = env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| node::home().map(|home| home.join(".local/share")))
        .unwrap_or_else(|| PathBuf::from("/tmp"));

    data_home.join("bita").join("bita.db")
}
