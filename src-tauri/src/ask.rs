use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::sync::oneshot;

use crate::model::{Problem, ProblemKind};
use crate::recap::{assistant_path, recap_binary, recap_command};

pub const ANSWER_EVENT: &str = "bita://live-answer";

const QUESTION_MAX_CHARS: usize = 600;

static NEXT_ASK: AtomicU64 = AtomicU64::new(1);
static RUNNING: LazyLock<Mutex<Option<Running>>> = LazyLock::new(|| Mutex::new(None));

struct Running {
    id: u64,
    cancel: oneshot::Sender<()>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnswerSource {
    pub kind: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_id: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Answer {
    pub id: String,
    pub asked_at: String,
    pub question: String,
    pub answer: String,
    pub found: bool,
    #[serde(default)]
    pub sources: Vec<AnswerSource>,
    #[serde(default)]
    pub auto: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answered_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub question_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ask_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StreamEvent {
    Question { text: String },
    Progress { text: String },
    Delta { text: String },
    Source { source: AnswerSource },
    Done { answer: Answer },
    Error { code: String, message: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnswerEvent {
    pub ask_id: u64,
    pub event: StreamEvent,
}

pub fn parse_stream_line(line: &str) -> Option<StreamEvent> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    let value: Value = serde_json::from_str(trimmed).ok()?;
    if value.get("type").is_some() {
        return serde_json::from_value(value).ok();
    }
    if value.get("ok").and_then(Value::as_bool) == Some(false) {
        let error = value.get("error");
        let code = error
            .and_then(|error| error.get("code"))
            .and_then(Value::as_str)
            .unwrap_or("UNKNOWN")
            .to_string();
        let message = error
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("recap falló sin decir por qué.")
            .to_string();
        return Some(StreamEvent::Error { code, message });
    }
    None
}

pub fn parse_jsonl<T: for<'de> Deserialize<'de>>(text: &str) -> Vec<T> {
    text.lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| serde_json::from_str::<T>(line).ok())
        .collect()
}

pub fn ask_args(question: Option<&str>) -> Vec<String> {
    let mut args = vec!["ask".to_string(), "--active".to_string()];
    if let Some(text) = question.map(str::trim).filter(|text| !text.is_empty()) {
        args.push("--question".into());
        args.push(text.chars().take(QUESTION_MAX_CHARS).collect());
    }
    args.push("--json-stream".into());
    args
}

pub fn is_asking() -> bool {
    RUNNING.lock().expect("ask poisoned").is_some()
}

pub fn cancel() -> bool {
    let running = RUNNING.lock().expect("ask poisoned").take();
    match running {
        Some(running) => running.cancel.send(()).is_ok(),
        None => false,
    }
}

fn finish(id: u64) {
    let mut slot = RUNNING.lock().expect("ask poisoned");
    if slot.as_ref().is_some_and(|running| running.id == id) {
        *slot = None;
    }
}

fn emit(app: &AppHandle, ask_id: u64, event: StreamEvent) {
    let _ = app.emit(ANSWER_EVENT, AnswerEvent { ask_id, event });
}

fn unsupported() -> StreamEvent {
    StreamEvent::Error {
        code: "UNSUPPORTED".into(),
        message: "Esta versión de recap no sabe responder en vivo: hace falta la 0.5 o posterior.".into(),
    }
}

fn spawn_in_runtime(command: &mut tokio::process::Command) -> std::io::Result<tokio::process::Child> {
    let _runtime = tauri::async_runtime::handle().inner().enter();
    command.spawn()
}

pub fn start(app: &AppHandle, question: Option<String>) -> Result<u64, Problem> {
    let recap = recap_binary().ok_or_else(crate::recap::missing)?;
    cancel();

    let id = NEXT_ASK.fetch_add(1, Ordering::SeqCst);
    let (sender, receiver) = oneshot::channel();
    *RUNNING.lock().expect("ask poisoned") = Some(Running { id, cancel: sender });

    let mut command = recap_command(&recap, &assistant_path());
    command
        .args(ask_args(question.as_deref()))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = match spawn_in_runtime(&mut command) {
        Ok(child) => child,
        Err(error) => {
            finish(id);
            return Err(Problem::new(ProblemKind::CliFailed, format!("No pude ejecutar recap: {error}")));
        }
    };

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let Some(stdout) = child.stdout.take() else {
            finish(id);
            return;
        };
        let mut stderr = child.stderr.take();
        let mut lines = BufReader::new(stdout).lines();
        let mut receiver = receiver;
        let mut understood = false;
        let mut settled = false;

        loop {
            tokio::select! {
                _ = &mut receiver => {
                    let _ = child.kill().await;
                    emit(&handle, id, StreamEvent::Error {
                        code: "CANCELLED".into(),
                        message: "Se canceló la pregunta.".into(),
                    });
                    return;
                }
                line = lines.next_line() => {
                    match line {
                        Ok(Some(text)) => {
                            if let Some(event) = parse_stream_line(&text) {
                                understood = true;
                                settled |= matches!(event, StreamEvent::Done { .. } | StreamEvent::Error { .. });
                                emit(&handle, id, event);
                            }
                        }
                        Ok(None) | Err(_) => break,
                    }
                }
            }
        }

        let status = child.wait().await.ok();
        finish(id);
        if settled {
            return;
        }
        let mut detail = String::new();
        if let Some(stream) = stderr.as_mut() {
            let _ = stream.read_to_string(&mut detail).await;
        }
        let event = if !understood {
            unsupported()
        } else {
            let code = status.and_then(|status| status.code()).unwrap_or(-1);
            StreamEvent::Error {
                code: "EXITED".into(),
                message: format!("recap terminó sin responder (código {code}). {}", detail.trim())
                    .trim()
                    .to_string(),
            }
        };
        emit(&handle, id, event);
    });

    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::{ask_args, parse_jsonl, parse_stream_line, spawn_in_runtime, Answer, StreamEvent};

    const DONE: &str = r#"{"type":"done","answer":{"id":"a1","askedAt":"2026-10-08T10:23:31Z","question":"¿Cómo se corre el simulador?","answer":"Con `pnpm sim:webhook`.","found":true,"sources":[{"kind":"page","label":"CoDi › Ambientes bajos","pageId":42},{"kind":"file","label":"sim/webhook.ts:18","path":"/Users/x/dev/codi/sim/webhook.ts","line":18,"repo":"codi-core"},{"kind":"commit","label":"a1c9e04","repo":"codi-core","sha":"a1c9e04"}]}}"#;

    #[test]
    fn a_child_spawns_from_a_thread_outside_the_runtime() {
        let status = std::thread::spawn(|| {
            let mut command = if cfg!(windows) {
                let mut shell = tokio::process::Command::new("cmd");
                shell.args(["/C", "exit 0"]);
                shell
            } else {
                tokio::process::Command::new("/usr/bin/true")
            };
            spawn_in_runtime(&mut command).map(|_| ())
        })
        .join()
        .expect("the spawning thread panicked");
        assert!(status.is_ok());
    }

    #[test]
    fn every_stream_event_kind_is_read() {
        assert_eq!(
            parse_stream_line(r#"{"type":"question","text":"¿Y en QA?"}"#),
            Some(StreamEvent::Question { text: "¿Y en QA?".into() })
        );
        assert_eq!(
            parse_stream_line(r#"{"type":"progress","text":"codi-core/README.md"}"#),
            Some(StreamEvent::Progress { text: "codi-core/README.md".into() })
        );
        assert_eq!(
            parse_stream_line(r#"{"type":"delta","text":"El simulador"}"#),
            Some(StreamEvent::Delta { text: "El simulador".into() })
        );
        let source = parse_stream_line(r#"{"type":"source","source":{"kind":"page","label":"CoDi","pageId":7}}"#);
        assert!(matches!(source, Some(StreamEvent::Source { source }) if source.page_id == Some(7)));
        assert_eq!(
            parse_stream_line(r#"{"type":"error","code":"NO_ACTIVE","message":"No hay reunión"}"#),
            Some(StreamEvent::Error { code: "NO_ACTIVE".into(), message: "No hay reunión".into() })
        );
    }

    #[test]
    fn a_done_line_carries_the_whole_answer_with_its_sources() {
        let Some(StreamEvent::Done { answer }) = parse_stream_line(DONE) else {
            panic!("done expected");
        };
        assert!(answer.found);
        assert_eq!(answer.sources.len(), 3);
        assert_eq!(answer.sources[1].line, Some(18));
        assert_eq!(answer.sources[2].sha.as_deref(), Some("a1c9e04"));
    }

    #[test]
    fn noise_and_unknown_types_are_skipped() {
        assert_eq!(parse_stream_line(""), None);
        assert_eq!(parse_stream_line("Usage: recap ask"), None);
        assert_eq!(parse_stream_line(r#"{"type":"thinking","text":"x"}"#), None);
        assert_eq!(parse_stream_line(r#"{"schemaVersion":1,"ok":true,"data":{}}"#), None);
    }

    #[test]
    fn a_failed_envelope_becomes_an_error_event() {
        assert_eq!(
            parse_stream_line(r#"{"schemaVersion":1,"ok":false,"error":{"code":"NOT_RECORDING","message":"No se está grabando"}}"#),
            Some(StreamEvent::Error { code: "NOT_RECORDING".into(), message: "No se está grabando".into() })
        );
    }

    #[test]
    fn the_answers_file_skips_broken_lines() {
        let line = DONE
            .strip_prefix(r#"{"type":"done","answer":"#)
            .and_then(|rest| rest.strip_suffix('}'))
            .expect("answer body");
        let text = format!("{line}\n\n{{broken\n{line}\n");
        let answers: Vec<Answer> = parse_jsonl(&text);
        assert_eq!(answers.len(), 2);
        assert_eq!(answers[0].id, "a1");
    }

    #[test]
    fn an_answer_is_manual_unless_it_says_auto() {
        let manual: Vec<Answer> = parse_jsonl(
            r#"{"id":"m1","askedAt":"2026-10-09T05:40:00Z","question":"¿Y en QA?","answer":"Igual.","found":true,"sources":[]}"#,
        );
        assert!(!manual[0].auto);
        let detected: Vec<Answer> = parse_jsonl(
            r#"{"id":"a2","askedAt":"2026-10-09T05:41:38Z","question":"¿Cómo se despliega bita-desktop?","answer":"Con release.sh.","found":true,"sources":[],"auto":true}"#,
        );
        assert!(detected[0].auto);
        let explicit: Vec<Answer> = parse_jsonl(
            r#"{"id":"a3","askedAt":"2026-10-09T05:42:00Z","question":"q","answer":"a","found":false,"auto":false}"#,
        );
        assert!(!explicit[0].auto);
    }

    #[test]
    fn an_answer_knows_where_its_question_came_from_when_recap_says_so() {
        let answers: Vec<Answer> = parse_jsonl(
            r#"{"id":"a4","askedAt":"2026-10-09T05:41:38Z","answeredAt":"2026-10-09T05:41:47Z","questionMs":1411000,"channel":"system","question":"q","answer":"a","found":true,"auto":true}"#,
        );
        assert_eq!(answers[0].answered_at.as_deref(), Some("2026-10-09T05:41:47Z"));
        assert_eq!(answers[0].question_ms, Some(1_411_000));
        assert_eq!(answers[0].channel.as_deref(), Some("system"));
    }

    #[test]
    fn an_older_answer_without_origin_still_reads_and_serializes_without_it() {
        let answers: Vec<Answer> = parse_jsonl(
            r#"{"id":"a5","askedAt":"2026-10-09T05:41:38Z","question":"q","answer":"a","found":true}"#,
        );
        assert_eq!(answers[0].answered_at, None);
        assert_eq!(answers[0].question_ms, None);
        assert_eq!(answers[0].channel, None);
        assert_eq!(answers[0].ask_id, None);
        let text = serde_json::to_string(&answers[0]).expect("serialize");
        assert!(!text.contains("answeredAt"));
        assert!(!text.contains("questionMs"));
        assert!(!text.contains("askId"));
    }

    #[test]
    fn an_answer_names_the_ask_that_produced_it() {
        let answers: Vec<Answer> = parse_jsonl(
            r#"{"id":"a6","askId":"k-17","askedAt":"2026-10-09T05:41:38Z","question":"q","answer":"a","found":true,"auto":true}"#,
        );
        assert_eq!(answers[0].ask_id.as_deref(), Some("k-17"));
        let text = serde_json::to_string(&answers[0]).expect("serialize");
        assert!(text.contains(r#""askId":"k-17""#));
    }

    #[test]
    fn a_typed_question_travels_trimmed_and_capped() {
        assert_eq!(ask_args(None), vec!["ask", "--active", "--json-stream"]);
        assert_eq!(ask_args(Some("   ")), vec!["ask", "--active", "--json-stream"]);
        assert_eq!(
            ask_args(Some("  ¿Cómo se despliega?  ")),
            vec!["ask", "--active", "--question", "¿Cómo se despliega?", "--json-stream"]
        );
        let long = "a".repeat(2000);
        assert_eq!(ask_args(Some(&long))[3].chars().count(), 600);
    }
}
