use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tokio::process::Command;
use tokio::time::timeout;

use crate::cli::node;
use crate::model::{Problem, ProblemKind};
use crate::notes_cmd::base64;

const RECAP_OVERRIDE_ENV: &str = "RECAP_CLI";
const CALL_TIMEOUT: Duration = Duration::from_secs(20);
const FRAMES_MAX: usize = 60;
const FRAME_MAX_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Debug, Deserialize)]
struct Envelope {
    ok: bool,
    #[serde(default)]
    data: Option<Record>,
    #[serde(default)]
    error: Option<EnvelopeError>,
}

#[derive(Debug, Deserialize)]
struct EnvelopeError {
    code: String,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    id: String,
    title: String,
    mode: String,
    status: String,
    dir: String,
    #[serde(default)]
    started_at: Option<String>,
    #[serde(default)]
    duration_seconds: Option<i64>,
    #[serde(default)]
    recording: Option<String>,
    #[serde(default)]
    summary: Option<String>,
    #[serde(default)]
    transcript_segments: Option<String>,
    #[serde(default)]
    frames: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub channel: String,
    pub text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FrameInfo {
    file: String,
    time_seconds: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub time_seconds: f64,
    pub src: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingView {
    pub id: String,
    pub title: String,
    pub mode: String,
    pub status: String,
    pub dir: String,
    pub started_at: Option<String>,
    pub duration_seconds: Option<i64>,
    pub recording: Option<String>,
    pub summary_markdown: Option<String>,
    pub segments: Vec<Segment>,
    pub frames: Vec<Frame>,
}

fn recap_binary() -> Option<PathBuf> {
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

fn inside(dir: &Path, path: &str) -> Option<PathBuf> {
    let candidate = PathBuf::from(path);
    let resolved = if candidate.is_absolute() { candidate } else { dir.join(candidate) };
    let canonical = std::fs::canonicalize(&resolved).ok()?;
    let root = std::fs::canonicalize(dir).ok()?;
    canonical.starts_with(&root).then_some(canonical)
}

fn read_frames(dir: &Path, index: &Path) -> Vec<Frame> {
    let Ok(text) = std::fs::read_to_string(index) else {
        return Vec::new();
    };
    let Ok(infos) = serde_json::from_str::<Vec<FrameInfo>>(&text) else {
        return Vec::new();
    };
    infos
        .into_iter()
        .take(FRAMES_MAX)
        .filter_map(|info| {
            let path = inside(dir, &info.file)?;
            let size = std::fs::metadata(&path).ok()?.len();
            if size > FRAME_MAX_BYTES {
                return None;
            }
            let bytes = std::fs::read(&path).ok()?;
            Some(Frame {
                time_seconds: info.time_seconds,
                src: format!("data:image/jpeg;base64,{}", base64(&bytes)),
            })
        })
        .collect()
}

#[tauri::command]
pub async fn meeting_for_entry(app: AppHandle, entry_id: i64) -> Result<Option<MeetingView>, Problem> {
    let Some(recap) = recap_binary() else {
        return Err(Problem::new(
            ProblemKind::CliFailed,
            "recap no está instalado en este equipo, así que no puedo mostrar la reunión.",
        )
        .with_hint(Some("bita setup".into())));
    };

    let mut command = Command::new(&recap);
    command
        .args(["show", "--bita-entry", &entry_id.to_string(), "--json"])
        .current_dir("/")
        .env_clear()
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .kill_on_drop(true);
    if let Some(home) = node::home() {
        command.env("HOME", home);
    }

    let output = timeout(CALL_TIMEOUT, command.output())
        .await
        .map_err(|_| Problem::new(ProblemKind::CliFailed, "recap no respondió a tiempo."))?
        .map_err(|error| Problem::new(ProblemKind::CliFailed, format!("No pude ejecutar recap: {error}")))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let envelope: Envelope = serde_json::from_str(stdout.trim()).map_err(|error| {
        Problem::new(ProblemKind::Unreadable, format!("No entiendo la respuesta de recap: {error}"))
    })?;

    if !envelope.ok {
        let error = envelope.error.unwrap_or(EnvelopeError {
            code: "UNKNOWN".into(),
            message: "recap falló sin decir por qué.".into(),
        });
        if error.code == "MEETING_NOT_FOUND" {
            return Ok(None);
        }
        return Err(Problem::new(ProblemKind::CliFailed, format!("{} ({})", error.message, error.code)));
    }

    let Some(record) = envelope.data else {
        return Ok(None);
    };
    let dir = PathBuf::from(&record.dir);
    if !dir.join("meeting.json").is_file() {
        return Ok(None);
    }

    let summary_markdown = record
        .summary
        .as_deref()
        .and_then(|path| inside(&dir, path))
        .and_then(|path| std::fs::read_to_string(path).ok());

    let segments = record
        .transcript_segments
        .as_deref()
        .and_then(|path| inside(&dir, path))
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str::<Vec<Segment>>(&text).ok())
        .unwrap_or_default();

    let frames = record
        .frames
        .as_deref()
        .and_then(|path| inside(&dir, path))
        .map(|path| read_frames(&dir, &path))
        .unwrap_or_default();

    let recording = record.recording.as_deref().and_then(|path| inside(&dir, path));
    if let Some(path) = &recording {
        let _ = app.asset_protocol_scope().allow_file(path);
    }

    Ok(Some(MeetingView {
        id: record.id,
        title: record.title,
        mode: record.mode,
        status: record.status,
        dir: dir.display().to_string(),
        started_at: record.started_at,
        duration_seconds: record.duration_seconds,
        recording: recording.map(|path| path.display().to_string()),
        summary_markdown,
        segments,
        frames,
    }))
}

#[tauri::command]
pub async fn open_meeting_folder(dir: String) -> Result<(), Problem> {
    let path = PathBuf::from(&dir);
    if !path.is_absolute() || !path.join("meeting.json").is_file() {
        return Err(Problem::new(
            ProblemKind::CliFailed,
            format!("{dir} no es la carpeta de una reunión de recap."),
        ));
    }
    Command::new("/usr/bin/open")
        .arg(&path)
        .status()
        .await
        .map_err(|error| Problem::new(ProblemKind::CliFailed, format!("No pude abrir la carpeta: {error}")))
        .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::inside;
    use std::fs;

    #[test]
    fn only_files_inside_the_meeting_folder_are_read() {
        let root = std::env::temp_dir().join(format!("bita-meeting-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("frames")).expect("frames");
        fs::write(root.join("summary.md"), "## Resumen").expect("summary");
        fs::write(root.join("frames/00-00-00.jpg"), "jpg").expect("frame");

        assert!(inside(&root, "summary.md").is_some());
        assert!(inside(&root, "frames/00-00-00.jpg").is_some());
        assert!(inside(&root, &root.join("summary.md").display().to_string()).is_some());
        assert!(inside(&root, "../etc/passwd").is_none());
        assert!(inside(&root, "/etc/hosts").is_none());
        assert!(inside(&root, "missing.md").is_none());
        let _ = fs::remove_dir_all(&root);
    }
}
