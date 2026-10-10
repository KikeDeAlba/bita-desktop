use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;
use tokio::process::Command;
use tokio::time::timeout;

use crate::cli::node;
use crate::model::{Problem, ProblemKind};
use crate::platform;

const RECAP_OVERRIDE_ENV: &str = "RECAP_CLI";
const PASSTHROUGH_ENV: [&str; 5] = ["RECAP_ROOT", "RECAP_STATE_DIR", "RECAP_CONFIG_PATH", "RECAP_DATA_DIR", "XDG_STATE_HOME"];
pub const NOT_FOUND: &str = "MEETING_NOT_FOUND";

#[derive(Debug, Deserialize)]
struct Envelope {
    ok: bool,
    #[serde(default)]
    data: Option<Value>,
    #[serde(default)]
    error: Option<EnvelopeError>,
}

#[derive(Debug, Clone, Deserialize)]
struct EnvelopeError {
    code: String,
    message: String,
}

#[derive(Debug, Clone)]
pub enum RecapError {
    Missing,
    Failed(Problem),
    Refused { code: String, message: String },
}

impl RecapError {
    pub fn is_not_found(&self) -> bool {
        matches!(self, RecapError::Refused { code, .. } if code == NOT_FOUND)
    }
}

impl From<RecapError> for Problem {
    fn from(error: RecapError) -> Self {
        match error {
            RecapError::Missing => missing(),
            RecapError::Failed(problem) => problem,
            RecapError::Refused { code, message } => {
                Problem::new(ProblemKind::CliFailed, format!("{} ({code})", refusal(&code, &message)))
            }
        }
    }
}

fn refusal(code: &str, message: &str) -> String {
    match code {
        "NOT_REMOTE" => "Esa reunión fue presencial: no tiene video.".into(),
        "NO_VIDEO" => "Esa reunión ya no tiene video.".into(),
        "MEETING_ACTIVE" => "La reunión sigue grabándose o procesándose.".into(),
        "NOT_SMALLER" => "Comprimirlo no lo hace más chico: el video se queda como está.".into(),
        _ => message.to_string(),
    }
}

pub fn missing() -> Problem {
    Problem::new(
        ProblemKind::CliFailed,
        "recap no está instalado en este equipo, así que no puedo mostrar la reunión.",
    )
    .with_hint(Some("bita setup".into()))
}

pub fn recap_binary() -> Option<PathBuf> {
    if let Some(explicit) = std::env::var_os(RECAP_OVERRIDE_ENV) {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Some(path);
        }
    }
    let mut candidates = Vec::new();
    if let Some(home) = node::home() {
        candidates.push(home.join(".local/bin/recap"));
        candidates.push(home.join("Applications/Recap.app/Contents/MacOS/recap"));
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin/recap"));
    candidates.push(PathBuf::from("/usr/local/bin/recap"));
    candidates.push(PathBuf::from("/Applications/Recap.app/Contents/MacOS/recap"));
    candidates.into_iter().find(|candidate| candidate.is_file())
}

pub async fn recap_call(args: &[&str], limit: Duration) -> Result<Value, RecapError> {
    let recap = recap_binary().ok_or(RecapError::Missing)?;

    let mut command = recap_command(&recap, platform::base_path());
    command.args(args).arg("--json");

    let output = timeout(limit, command.output())
        .await
        .map_err(|_| {
            RecapError::Failed(Problem::new(
                ProblemKind::CliFailed,
                format!("recap no respondió en {} s.", limit.as_secs()),
            ))
        })?
        .map_err(|error| {
            RecapError::Failed(Problem::new(ProblemKind::CliFailed, format!("No pude ejecutar recap: {error}")))
        })?;

    parse(&String::from_utf8_lossy(&output.stdout), &String::from_utf8_lossy(&output.stderr))
}

pub fn recap_command(recap: &std::path::Path, path: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut command = Command::new(recap);
    platform::quiet(&mut command)
        .current_dir(platform::neutral_dir())
        .env_clear()
        .envs(platform::essential_env())
        .env("PATH", path)
        .stdin(Stdio::null())
        .kill_on_drop(true);
    if let Some(home) = node::home() {
        command.env("HOME", home);
    }
    for (key, value) in node::identity() {
        command.env(key, value);
    }
    for key in PASSTHROUGH_ENV {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    command
}

pub fn assistant_path() -> std::ffi::OsString {
    let mut parts: Vec<PathBuf> = Vec::new();
    if let Some(home) = node::home() {
        parts.push(home.join(".local").join("bin"));
        parts.push(home.join(".claude").join("local"));
    }
    parts.extend(platform::package_manager_dirs());
    platform::search_path(parts)
}

pub(crate) fn parse(stdout: &str, stderr: &str) -> Result<Value, RecapError> {
    let line = stdout.trim();
    if line.is_empty() {
        return Err(RecapError::Failed(Problem::new(
            ProblemKind::Unreadable,
            format!("recap no devolvió nada: {}", stderr.trim()),
        )));
    }
    let envelope: Envelope = serde_json::from_str(line).map_err(|error| {
        RecapError::Failed(Problem::new(
            ProblemKind::Unreadable,
            format!("No entiendo la respuesta de recap: {error}"),
        ))
    })?;
    if !envelope.ok {
        let error = envelope.error.unwrap_or(EnvelopeError {
            code: "UNKNOWN".into(),
            message: "recap falló sin decir por qué.".into(),
        });
        return Err(RecapError::Refused {
            code: error.code,
            message: error.message,
        });
    }
    Ok(envelope.data.unwrap_or(Value::Null))
}

#[cfg(test)]
mod tests {
    use super::{parse, RecapError};

    #[test]
    fn a_successful_envelope_yields_its_data() {
        let data = parse(r#"{"schemaVersion":1,"ok":true,"data":{"id":"x"}}"#, "").expect("ok");
        assert_eq!(data["id"], "x");
    }

    #[test]
    fn a_missing_meeting_is_told_apart() {
        let error = parse(
            r#"{"schemaVersion":1,"ok":false,"error":{"code":"MEETING_NOT_FOUND","message":"no"}}"#,
            "",
        )
        .expect_err("refused");
        assert!(error.is_not_found());
        let other = parse(r#"{"ok":false,"error":{"code":"NO_VIDEO","message":"no"}}"#, "").expect_err("refused");
        assert!(!other.is_not_found());
        assert!(matches!(other, RecapError::Refused { .. }));
    }

    #[test]
    fn silence_and_garbage_are_failures() {
        assert!(matches!(parse("", "boom"), Err(RecapError::Failed(_))));
        assert!(matches!(parse("nope", ""), Err(RecapError::Failed(_))));
    }
}
