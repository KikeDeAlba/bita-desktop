use serde::{Deserialize, Serialize};

pub const SUPPORTED_SCHEMA: u32 = 3;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Envelope<T> {
    pub schema_version: u32,
    pub ok: bool,
    pub data: Option<T>,
    pub meta: Option<serde_json::Value>,
    pub error: Option<CliError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliError {
    pub code: String,
    pub message: String,
    #[serde(default)]
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: i64,
    pub description: String,
    #[serde(default)]
    pub project_id: Option<i64>,
    #[serde(default)]
    pub project_name: Option<String>,
    pub start: String,
    #[serde(default)]
    pub stop: Option<String>,
    pub start_local: String,
    pub local_day: String,
    pub duration_seconds: i64,
    pub duration_human: String,
    pub registered: bool,
    pub running: bool,
}

impl Entry {
    pub fn is_draft(&self) -> bool {
        self.description.trim().is_empty()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveTimer {
    pub id: i64,
    pub title: Option<String>,
    pub project_name: Option<String>,
    pub project_id: Option<i64>,
    pub started_at: String,
    pub start_local: String,
    pub elapsed_seconds: i64,
    pub draft: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub running: Vec<LiveTimer>,
    pub today_seconds: i64,
    pub problem: Option<Problem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    pub kind: ProblemKind,
    pub message: String,
    #[serde(default)]
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProblemKind {
    NodeMissing,
    CliMissing,
    SchemaMismatch,
    CliFailed,
    Unreadable,
}

impl Problem {
    pub fn new(kind: ProblemKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            hint: None,
        }
    }

    pub fn with_hint(mut self, hint: Option<String>) -> Self {
        self.hint = hint;
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub summary: String,
    #[serde(default)]
    pub project_id: Option<i64>,
    #[serde(default)]
    pub project_name: Option<String>,
    pub total_seconds: i64,
    pub total_human: String,
    pub estimate_seconds: i64,
    pub estimate_human: String,
    pub entry_ids: Vec<i64>,
    pub days: Vec<String>,
    pub part_index: u32,
    pub part_count: u32,
    #[serde(default)]
    pub jira_project_key: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryData {
    pub total_seconds: i64,
    pub total_human: String,
    pub groups: Vec<Group>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Overlap {
    pub local_day: String,
    pub tracked_seconds: i64,
    pub clock_seconds: i64,
    pub overlap_seconds: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Excluded {
    pub id: i64,
    pub description: String,
    #[serde(default)]
    pub project_name: Option<String>,
    pub duration_human: String,
    pub reason: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryMeta {
    #[serde(default)]
    pub overlaps: Vec<Overlap>,
    #[serde(default)]
    pub excluded: Vec<Excluded>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryView {
    pub total_seconds: i64,
    pub total_human: String,
    pub estimate_seconds: i64,
    pub groups: Vec<Group>,
    pub overlaps: Vec<Overlap>,
    pub excluded: Vec<Excluded>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scope {
    pub prefix: String,
    pub project_id: i64,
    pub project_name: String,
    pub slug_source: String,
}
