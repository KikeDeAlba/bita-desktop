use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use std::{env, fs};

use serde::Serialize;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};
use tokio::process::Command;
use tokio::time::timeout;

use crate::cli::{self, node, Source};
use crate::model::{Problem, ProblemKind};

const BUNDLED_ROOT: &str = "bita";
const INSTALL_TIMEOUT: Duration = Duration::from_secs(60);
const COPY_DIR: &str = ".local/share/bita-desktop/cli";

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Health {
    Ok,
    Warn,
    Fail,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub id: String,
    pub health: Health,
    pub title: String,
    pub detail: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub checks: Vec<Check>,
    pub can_install: bool,
    pub blocked: bool,
}

const MIN_CLI: &str = "0.3.0";

fn parts(version: &str) -> Vec<u32> {
    version
        .trim()
        .trim_start_matches('v')
        .split('.')
        .map(|piece| {
            piece
                .chars()
                .take_while(char::is_ascii_digit)
                .collect::<String>()
                .parse()
                .unwrap_or(0)
        })
        .collect()
}

fn is_older(found: &str, wanted: &str) -> bool {
    if !found.chars().any(|piece| piece.is_ascii_digit()) {
        return false;
    }
    let found = parts(found);
    let wanted = parts(wanted);
    for index in 0..wanted.len().max(found.len()) {
        let left = found.get(index).copied().unwrap_or(0);
        let right = wanted.get(index).copied().unwrap_or(0);
        if left != right {
            return left < right;
        }
    }
    false
}

pub async fn report(app: &AppHandle) -> Report {
    let mut checks = Vec::new();
    let mut blocked = false;

    let node = node::discover().await;
    match node.as_ref() {
        Some(path) => {
            let version = node::major_version(path).await.unwrap_or(0);
            checks.push(Check {
                id: "node".into(),
                health: Health::Ok,
                title: format!("Node {version}"),
                detail: path.display().to_string(),
                note: None,
            });
        }
        None => {
            blocked = true;
            checks.push(Check {
                id: "node".into(),
                health: Health::Fail,
                title: format!("Falta Node {} o superior", node::MIN_MAJOR),
                detail: "Es lo único que la app no puede resolver sola.".into(),
                note: Some(if which("brew").is_some() {
                    "brew install node".into()
                } else {
                    "https://nodejs.org".into()
                }),
            });
        }
    }

    let source = cli::resolve_entry(app);
    let can_install = matches!(source, Some((_, Source::Bundled))) && !blocked;
    match source.as_ref() {
        Some((path, Source::Installed)) => {
            let found = node
                .as_ref()
                .map(|node| cli::version_of(node, path))
                .unwrap_or(None);
            let stale = found
                .as_deref()
                .map(|value| is_older(value, MIN_CLI))
                .unwrap_or(false);

            checks.push(if stale {
                Check {
                    id: "cli".into(),
                    health: Health::Warn,
                    title: format!(
                        "El CLI instalado es la {}, y las notas piden la {MIN_CLI}",
                        found.clone().unwrap_or_default()
                    ),
                    detail: path.display().to_string(),
                    note: Some(
                        "Instálalo de nuevo aquí abajo para dejar la copia que trae la app.".into(),
                    ),
                }
            } else {
                Check {
                    id: "cli".into(),
                    health: Health::Ok,
                    title: match found.as_deref() {
                        Some(value) => format!("El CLI de bita {value}, instalado"),
                        None => "El CLI de bita, instalado".into(),
                    },
                    detail: path.display().to_string(),
                    note: None,
                }
            });
        }
        Some((path, Source::Bundled)) => checks.push(Check {
            id: "cli".into(),
            health: Health::Warn,
            title: "El CLI no está en tu PATH".into(),
            detail: format!(
                "No pasa nada: la app usa la copia que trae dentro.\n{}",
                path.display()
            ),
            note: Some(
                "Instalarlo enlaza bita en tu terminal y, de paso, la skill, los comandos y los hooks de Claude Code."
                    .into(),
            ),
        }),
        None => {
            blocked = true;
            checks.push(Check {
                id: "cli".into(),
                health: Health::Fail,
                title: "No encuentro el CLI de bita".into(),
                detail: "Ni instalado, ni dentro de la app.".into(),
                note: None,
            });
        }
    }

    let database = cli::database_path();
    if database.is_file() {
        let size = fs::metadata(&database).map(|meta| meta.len()).unwrap_or(0);
        checks.push(Check {
            id: "database".into(),
            health: Health::Ok,
            title: format!("Tu bitácora, {} KB", size / 1024),
            detail: database.display().to_string(),
            note: None,
        });
    } else {
        checks.push(Check {
            id: "database".into(),
            health: Health::Warn,
            title: "Todavía no hay bitácora".into(),
            detail: database.display().to_string(),
            note: Some("Se crea sola con el primer cronómetro.".into()),
        });
    }

    Report {
        checks,
        can_install,
        blocked,
    }
}

pub async fn install(app: &AppHandle) -> Result<String, Problem> {
    let node = node::discover().await.ok_or_else(|| {
        Problem::new(
            ProblemKind::NodeMissing,
            format!("No encuentro Node {} o superior.", node::MIN_MAJOR),
        )
    })?;

    let bundled = app
        .path()
        .resolve(BUNDLED_ROOT, BaseDirectory::Resource)
        .map_err(|_| {
            Problem::new(
                ProblemKind::CliMissing,
                "La app no trae una copia del CLI.",
            )
        })?;

    let home = node::home().ok_or_else(|| {
        Problem::new(ProblemKind::CliMissing, "No sé cuál es tu carpeta personal.")
    })?;

    let target = home.join(COPY_DIR);
    copy_tree(&bundled, &target).map_err(|error| {
        Problem::new(
            ProblemKind::CliMissing,
            format!("No pude copiar el CLI a {}: {error}", target.display()),
        )
    })?;

    let bin_dir = preferred_bin_dir(&home);
    fs::create_dir_all(&bin_dir).map_err(|error| {
        Problem::new(
            ProblemKind::CliMissing,
            format!("No pude crear {}: {error}", bin_dir.display()),
        )
    })?;

    let node_dir = node
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("/usr/bin"));

    let output = timeout(
        INSTALL_TIMEOUT,
        Command::new("/bin/bash")
            .arg(target.join("scripts/install.sh"))
            .current_dir(&target)
            .env_clear()
            .env("HOME", &home)
            .env(
                "PATH",
                format!("{}:/usr/bin:/bin:/usr/sbin:/sbin", node_dir.display()),
            )
            .env("BITA_BIN_DIR", &bin_dir)
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| Problem::new(ProblemKind::CliFailed, "El instalador no terminó a tiempo."))?
    .map_err(|error| {
        Problem::new(
            ProblemKind::CliFailed,
            format!("No pude ejecutar el instalador: {error}"),
        )
    })?;

    let mut log = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !stderr.trim().is_empty() {
        log.push('\n');
        log.push_str(stderr.trim());
    }

    if !output.status.success() {
        return Err(Problem::new(
            ProblemKind::CliFailed,
            format!("El instalador falló.\n{}", log.trim()),
        ));
    }

    Ok(log.trim().to_string())
}

fn preferred_bin_dir(home: &Path) -> PathBuf {
    if let Some(pnpm_home) = env::var_os("PNPM_HOME") {
        let candidate = PathBuf::from(pnpm_home).join("bin");
        if candidate.is_dir() {
            return candidate;
        }
    }
    for candidate in [home.join("Library/pnpm/bin"), home.join(".local/bin")] {
        if candidate.is_dir() {
            return candidate;
        }
    }
    home.join(".local/bin")
}

fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    if to.exists() {
        fs::remove_dir_all(to)?;
    }
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let destination = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &destination)?;
        } else {
            fs::copy(entry.path(), &destination)?;
        }
    }
    Ok(())
}

fn which(program: &str) -> Option<PathBuf> {
    for directory in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        let candidate = Path::new(directory).join(program);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::is_older;

    #[test]
    fn compares_versions_piece_by_piece() {
        assert!(is_older("0.2.0", "0.3.0"));
        assert!(is_older("0.2.9", "0.3.0"));
        assert!(!is_older("0.3.0", "0.3.0"));
        assert!(!is_older("0.3.1", "0.3.0"));
        assert!(!is_older("1.0.0", "0.3.0"));
    }

    #[test]
    fn survives_a_version_it_cannot_read() {
        assert!(!is_older("", "0.3.0"));
        assert!(!is_older("bita 0.3.0", "0.3.0"));
        assert!(is_older("v0.2", "0.3.0"));
    }
}
