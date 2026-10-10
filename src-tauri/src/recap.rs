use std::ffi::OsString;
use std::path::PathBuf;
use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;
use tokio::process::Command;
use tokio::time::timeout;

use crate::cli::node;
use crate::model::{Problem, ProblemKind};
use crate::registry::Tool;

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
    crate::registry::missing_problem(Tool::Recap)
}

pub fn recap_binary() -> Option<Vec<OsString>> {
    crate::registry::global().resolve_now(Tool::Recap).map(|found| found.bin)
}

pub async fn recap_call(args: &[&str], limit: Duration) -> Result<Value, RecapError> {
    let recap = recap_binary().ok_or(RecapError::Missing)?;

    let mut command = recap_command(&recap, None).ok_or(RecapError::Missing)?;
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

pub fn recap_command(recap: &[OsString], path: Option<OsString>) -> Option<Command> {
    crate::registry::command(recap, path)
}

pub fn assistant_path(recap: &[OsString]) -> OsString {
    let mut parts: Vec<PathBuf> = Vec::new();
    if let Some(home) = node::home() {
        parts.push(home.join(".local").join("bin"));
        parts.push(home.join(".claude").join("local"));
    }
    parts.extend(std::env::split_paths(&crate::registry::path_for(recap)));
    crate::platform::search_path(parts)
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
