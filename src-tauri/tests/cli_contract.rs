use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::{env, fs};

const EXPECTED_SCHEMA: u64 = 3;
const REGISTRY_ENV: &str = "KIT_REGISTRY_DIR";

fn registry() -> Option<PathBuf> {
    let dir = PathBuf::from(env::var_os(REGISTRY_ENV).filter(|value| !value.is_empty())?);
    dir.is_dir().then_some(dir)
}

fn registered_bin(tool: &str) -> Option<Vec<String>> {
    let text = fs::read_to_string(registry()?.join(format!("{tool}.json"))).ok()?;
    let manifest: serde_json::Value = serde_json::from_str(&text).ok()?;
    let bin: Vec<String> = manifest["bin"]
        .as_array()?
        .iter()
        .filter_map(|part| part.as_str().map(str::to_string))
        .collect();
    let installed = !bin.is_empty() && bin.iter().all(|part| !Path::new(part).is_absolute() || Path::new(part).exists());
    installed.then_some(bin)
}

struct Sandbox {
    bins: Vec<(String, Vec<String>)>,
    root: PathBuf,
}

impl Sandbox {
    fn new(tools: &[&str], name: &str) -> Option<Self> {
        let mut bins = Vec::new();
        for tool in tools {
            let Some(bin) = registered_bin(tool) else {
                eprintln!("skipped: {tool} is not in the sandbox registry ({REGISTRY_ENV})");
                return None;
            };
            bins.push((tool.to_string(), bin));
        }
        let root = env::temp_dir().join(format!("den-contract-{}-{name}-{}", tools.join("-"), std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("home")).expect("sandbox home");
        Some(Self { bins, root })
    }

    fn bin(&self, tool: &str) -> &[String] {
        &self.bins.iter().find(|(name, _)| name == tool).expect("tool in the sandbox").1
    }

    fn path(&self) -> OsString {
        let mut parts: Vec<PathBuf> = Vec::new();
        for (_, bin) in &self.bins {
            if let Some(parent) = Path::new(&bin[0]).parent() {
                parts.push(parent.to_path_buf());
            }
        }
        parts.extend(env::split_paths(&env::var_os("PATH").unwrap_or_default()));
        env::join_paths(parts).unwrap_or_default()
    }

    fn run(&self, tool: &str, args: &[&str]) -> serde_json::Value {
        let bin = self.bin(tool);
        let output = Command::new(&bin[0])
            .args(&bin[1..])
            .args(args)
            .arg("--json")
            .current_dir(&self.root)
            .env_clear()
            .env("PATH", self.path())
            .env("HOME", self.root.join("home"))
            .env("XDG_CONFIG_HOME", self.root.join("home/.config"))
            .env("XDG_DATA_HOME", self.root.join("home/.local/share"))
            .env("XDG_STATE_HOME", self.root.join("home/.local/state"))
            .env("APPDATA", self.root.join("home/AppData/Roaming"))
            .env("LOCALAPPDATA", self.root.join("home/AppData/Local"))
            .env(REGISTRY_ENV, registry().expect("registry"))
            .env("KIT_CREDENTIALS", "file")
            .env("KIT_NO_EVENTS", "1")
            .env("BITA_NO_HOOKS", "1")
            .env("INKWELL_DB_PATH", self.root.join("inkwell.db"))
            .env("INKWELL_DOCS_DIR", self.root.join("inkwell-docs"))
            .env("GIT_AUTHOR_NAME", "den contract")
            .env("GIT_AUTHOR_EMAIL", "contract@den.invalid")
            .env("GIT_COMMITTER_NAME", "den contract")
            .env("GIT_COMMITTER_EMAIL", "contract@den.invalid")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .expect("run the registered tool");
        let stdout = String::from_utf8_lossy(&output.stdout);
        let line = stdout.trim().lines().last().unwrap_or_default().to_string();
        serde_json::from_str(&line).unwrap_or_else(|_| {
            panic!(
                "{tool} {args:?} did not print one JSON document: {stdout} {}",
                String::from_utf8_lossy(&output.stderr)
            )
        })
    }

    fn declares(&self, tool: &str, capability: &str) -> bool {
        self.run(tool, &["capabilities"])["data"]["capabilities"]
            .as_array()
            .is_some_and(|list| list.iter().any(|value| value.as_str() == Some(capability)))
    }
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn has_fields(value: &serde_json::Value, fields: &[&str], what: &str) {
    for field in fields {
        assert!(value.get(*field).is_some(), "{what} lost {field}: {value}");
    }
}

#[test]
fn every_registered_tool_answers_its_capabilities() {
    let Some(dir) = registry() else {
        eprintln!("skipped: {REGISTRY_ENV} is not set");
        return;
    };
    for entry in fs::read_dir(&dir).expect("registry").flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(tool) = name.strip_suffix(".json") else { continue };
        let Some(sandbox) = Sandbox::new(&[tool], "capabilities") else { continue };
        let envelope = sandbox.run(tool, &["capabilities"]);
        assert_eq!(envelope["ok"].as_bool(), Some(true), "{tool}: {envelope}");
        assert_eq!(envelope["data"]["name"].as_str(), Some(tool), "{envelope}");
        assert!(envelope["data"]["capabilities"].is_array(), "{envelope}");
    }
}

#[test]
fn bita_still_speaks_the_schema_this_app_understands() {
    let Some(sandbox) = Sandbox::new(&["bita"], "schema") else { return };
    let envelope = sandbox.run("bita", &["ls"]);
    assert_eq!(
        envelope["schemaVersion"].as_u64(),
        Some(EXPECTED_SCHEMA),
        "bita changed its envelope version; the app's model has to change with it"
    );
    assert_eq!(envelope["ok"].as_bool(), Some(true));
    assert!(envelope["data"].is_array());
}

#[test]
fn bita_lists_the_entries_the_hoy_tab_groups() {
    let Some(sandbox) = Sandbox::new(&["bita"], "entries") else { return };
    assert_eq!(sandbox.run("bita", &["project", "add", "Contrato"])["ok"].as_bool(), Some(true));
    for title in ["Rotar el secreto", "Rotar el secreto"] {
        let logged = sandbox.run("bita", &["log", title, "--project", "Contrato", "--from", "00:10", "--for", "30m"]);
        assert_eq!(logged["ok"].as_bool(), Some(true), "{logged}");
    }
    for range in ["today", "week"] {
        let listed = sandbox.run("bita", &["entries", range]);
        assert_eq!(listed["schemaVersion"].as_u64(), Some(EXPECTED_SCHEMA));
        assert_eq!(listed["ok"].as_bool(), Some(true), "{listed}");
        let entries = listed["data"].as_array().expect("entries");
        assert!(!entries.is_empty(), "{listed}");
        for entry in entries {
            has_fields(
                entry,
                &[
                    "id", "description", "projectId", "projectName", "start", "stop", "startLocal", "localDay",
                    "durationSeconds", "durationHuman", "running",
                ],
                "entries",
            );
        }
    }
}

#[test]
fn bita_lists_the_projects_the_app_reads() {
    let Some(sandbox) = Sandbox::new(&["bita"], "projects") else { return };
    let added = sandbox.run("bita", &["project", "add", "Contrato"]);
    assert_eq!(added["ok"].as_bool(), Some(true), "{added}");
    let listed = sandbox.run("bita", &["projects"]);
    assert_eq!(listed["ok"].as_bool(), Some(true), "{listed}");
    for project in listed["data"].as_array().expect("projects") {
        has_fields(project, &["id", "name", "active", "clientName"], "projects");
    }
}

#[test]
fn bita_lists_project_repos() {
    let Some(sandbox) = Sandbox::new(&["bita"], "repos") else { return };
    assert_eq!(sandbox.run("bita", &["project", "add", "Contrato"])["ok"].as_bool(), Some(true));
    let listed = sandbox.run("bita", &["project", "repo", "ls", "--project", "Contrato"]);
    assert_eq!(listed["schemaVersion"].as_u64(), Some(EXPECTED_SCHEMA));
    assert_eq!(listed["ok"].as_bool(), Some(true), "{listed}");
    for repo in listed["data"]["repos"].as_array().expect("repos") {
        has_fields(repo, &["project", "path", "slug", "source", "addedAt", "lastSeenAt", "exists"], "repos");
    }
}

#[test]
fn inkwell_answers_the_docs_contract() {
    let Some(sandbox) = Sandbox::new(&["inkwell"], "contract") else { return };
    assert!(sandbox.declares("inkwell", "docs.page.read"));

    let migrated = sandbox.run("inkwell", &["migrate", "status"]);
    assert_eq!(migrated["ok"].as_bool(), Some(true), "{migrated}");
    assert!(migrated["data"]["migrated"].is_boolean(), "{migrated}");

    let tree = sandbox.run("inkwell", &["tree", "--pages", "--months"]);
    assert_eq!(tree["ok"].as_bool(), Some(true), "{tree}");
    assert!(tree["data"]["spaces"].is_array(), "{tree}");
}

#[test]
fn inkwell_lists_the_notes_of_each_entry() {
    let Some(sandbox) = Sandbox::new(&["inkwell"], "entry-notes") else { return };
    if !sandbox.declares("inkwell", "docs.entry-notes") {
        eprintln!("skipped: this inkwell does not declare docs.entry-notes");
        return;
    }
    for args in [
        &["note", "ls", "today", "--limit", "0"][..],
        &["note", "ls", "--limit", "5", "--offset", "0"][..],
        &["note", "search", "secreto"][..],
    ] {
        let listed = sandbox.run("inkwell", args);
        assert_eq!(listed["ok"].as_bool(), Some(true), "{args:?}: {listed}");
        assert!(listed["data"].is_array(), "{args:?}: {listed}");
    }
}

fn new_page(sandbox: &Sandbox, title: &str) -> String {
    let space = sandbox.run("inkwell", &["space", "add", "Contrato"]);
    assert_eq!(space["ok"].as_bool(), Some(true), "{space}");
    let page = sandbox.run("inkwell", &["page", "new", title, "--project", "Contrato"]);
    assert_eq!(page["ok"].as_bool(), Some(true), "{page}");
    page["data"]["page"]["pageId"]
        .as_i64()
        .or_else(|| page["data"]["pageId"].as_i64())
        .expect("the new page has an id")
        .to_string()
}

fn write_page(sandbox: &Sandbox, page_id: &str, body: &str) {
    let markdown = sandbox.root.join("body.md");
    fs::write(&markdown, body).expect("body");
    let wrote = sandbox.run("inkwell", &["page", "write", page_id, "--md", &markdown.display().to_string()]);
    assert_eq!(wrote["ok"].as_bool(), Some(true), "{wrote}");
}

#[test]
fn inkwell_lists_the_backlog_the_app_paints() {
    let Some(sandbox) = Sandbox::new(&["inkwell"], "backlog") else { return };
    let space = sandbox.run("inkwell", &["space", "add", "Contrato"]);
    assert_eq!(space["ok"].as_bool(), Some(true), "{space}");

    let added = sandbox.run(
        "inkwell",
        &["backlog", "add", "--kind", "pending", "--title", "Rotar el secreto", "--project", "Contrato"],
    );
    assert_eq!(added["ok"].as_bool(), Some(true), "{added}");
    let id = added["data"]["id"].as_i64().expect("the new item has an id").to_string();

    let resolved = sandbox.run("inkwell", &["backlog", "resolve", &id, "--resolution", "Rotado"]);
    assert_eq!(resolved["data"]["status"].as_str(), Some("resolved"), "{resolved}");
    let reopened = sandbox.run("inkwell", &["backlog", "reopen", &id]);
    assert_eq!(reopened["data"]["status"].as_str(), Some("open"), "{reopened}");
    let edited = sandbox.run("inkwell", &["backlog", "edit", &id, "--kind", "finding"]);
    assert_eq!(edited["data"]["kind"].as_str(), Some("finding"), "{edited}");

    let listed = sandbox.run("inkwell", &["backlog", "ls", "--status", "all"]);
    has_fields(
        &listed["data"][0],
        &["id", "key", "kind", "status", "title", "body", "projectName", "pageId", "pageTitle", "updatedAt", "resolution", "createdAt"],
        "backlog items",
    );
}

#[test]
fn inkwell_searches_by_page() {
    let Some(sandbox) = Sandbox::new(&["inkwell"], "pages") else { return };
    let page_id = new_page(&sandbox, "Kernel compartido");
    write_page(&sandbox, &page_id, "## Contexto\n\nLa paridad del kernel compartido exige la misma rama.\n");

    let found = sandbox.run("inkwell", &["search", "paridad", "--pages", "--project", "Contrato"]);
    assert_eq!(found["ok"].as_bool(), Some(true), "{found}");
    let hit = &found["data"][0];
    has_fields(hit, &["pageId", "title", "projectName", "relPath", "matchCount", "matches"], "page hits");
    has_fields(&hit["matches"][0], &["section", "line", "prefix", "match", "suffix"], "page matches");
}

#[test]
fn inkwell_keeps_the_history_of_a_page() {
    let Some(sandbox) = Sandbox::new(&["inkwell"], "history") else { return };
    let page_id = new_page(&sandbox, "Kernel compartido");
    for body in ["## Contexto\n\nPrimera versión.\n", "## Contexto\n\nSegunda versión.\n"] {
        write_page(&sandbox, &page_id, body);
    }

    let history = sandbox.run("inkwell", &["page", "history", &page_id]);
    assert_eq!(history["ok"].as_bool(), Some(true), "{history}");
    let revisions = history["data"]["revisions"].as_array().expect("revisions");
    assert!(revisions.len() >= 2, "{history}");
    for revision in revisions {
        has_fields(revision, &["sha", "date", "subject"], "revisions");
    }

    let oldest = revisions.last().and_then(|revision| revision["sha"].as_str()).expect("sha");
    let diff = sandbox.run("inkwell", &["page", "diff", &page_id, oldest]);
    assert_eq!(diff["ok"].as_bool(), Some(true), "{diff}");
    has_fields(&diff["data"], &["pageId", "from", "to", "diff", "hunks"], "page diff");
}

#[test]
fn inkwell_keeps_atlassian_settings_per_space() {
    let Some(sandbox) = Sandbox::new(&["inkwell"], "atlassian") else { return };
    new_page(&sandbox, "Kernel compartido");
    let set = sandbox.run(
        "inkwell",
        &["space", "set", "Contrato", "--confluence", "STI", "--pull", "on", "--push", "off"],
    );
    assert_eq!(set["ok"].as_bool(), Some(true), "{set}");

    let tree = sandbox.run("inkwell", &["tree", "--pages", "--months"]);
    let space = tree["data"]["spaces"]
        .as_array()
        .expect("spaces")
        .iter()
        .find(|space| space["projectName"].as_str() == Some("Contrato"))
        .cloned()
        .expect("the space is listed");
    let atlassian = &space["atlassian"];
    assert_eq!(atlassian["sync"]["pull"].as_bool(), Some(true), "{space}");
    assert_eq!(atlassian["sync"]["push"].as_bool(), Some(false), "{space}");

    let status = sandbox.run("inkwell", &["confluence", "status", "Contrato"]);
    assert_eq!(status["ok"].as_bool(), Some(true), "{status}");
    assert!(status["data"].is_array(), "{status}");
}

#[test]
fn atl_lists_the_sites_the_window_draws() {
    let Some(sandbox) = Sandbox::new(&["atl"], "sites") else { return };
    let listed = sandbox.run("atl", &["site", "ls"]);
    assert_eq!(listed["ok"].as_bool(), Some(true), "{listed}");
    assert!(listed["data"].is_array(), "{listed}");
}

#[test]
fn tally_reports_the_pending_time_in_the_summary_shape() {
    let Some(sandbox) = Sandbox::new(&["bita", "tally"], "pending") else { return };
    assert_eq!(sandbox.run("bita", &["project", "add", "Contrato"])["ok"].as_bool(), Some(true));
    let logged = sandbox.run("bita", &["log", "Algo para Jira", "--project", "Contrato", "--from", "00:10", "--for", "30m"]);
    assert_eq!(logged["ok"].as_bool(), Some(true), "{logged}");

    let pending = sandbox.run("tally", &["summary", "--pending"]);
    assert_eq!(pending["ok"].as_bool(), Some(true), "{pending}");
    has_fields(&pending["data"], &["totalSeconds", "totalHuman", "groups"], "tally summary");
    let groups = pending["data"]["groups"].as_array().expect("groups");
    for group in groups {
        has_fields(
            group,
            &[
                "summary", "projectId", "projectName", "totalSeconds", "totalHuman", "estimateSeconds", "estimateHuman",
                "entryIds", "days", "partIndex", "partCount",
            ],
            "tally groups",
        );
    }
}

const REPORT_FROM: &str = "2026-01-05";
const REPORT_TO: &str = "2026-01-11";

fn lacks_command(envelope: &serde_json::Value) -> bool {
    let code = envelope["error"]["code"].as_str();
    let message = envelope["error"]["message"].as_str().unwrap_or_default().to_lowercase();
    code == Some("UNKNOWN_COMMAND") || (code == Some("USAGE_ERROR") && message.starts_with("unknown command"))
}

fn log_a_past_block(sandbox: &Sandbox) {
    assert_eq!(sandbox.run("bita", &["project", "add", "Contrato"])["ok"].as_bool(), Some(true));
    let logged = sandbox.run(
        "bita",
        &["log", "Rotar el secreto", "--project", "Contrato", "--from", "2026-01-06T10:00", "--for", "30m"],
    );
    assert_eq!(logged["ok"].as_bool(), Some(true), "{logged}");
}

#[test]
fn bita_reports_the_time_per_project_the_reports_window_draws() {
    let Some(sandbox) = Sandbox::new(&["bita"], "report") else { return };
    if !sandbox.declares("bita", "time.report.read") && lacks_command(&sandbox.run("bita", &["report", "today"])) {
        eprintln!("skipped: this bita has no report command");
        return;
    }
    log_a_past_block(&sandbox);

    let report = sandbox.run("bita", &["report", "--from", REPORT_FROM, "--to", REPORT_TO, "--entries"]);
    assert_eq!(report["schemaVersion"].as_u64(), Some(EXPECTED_SCHEMA));
    assert_eq!(report["ok"].as_bool(), Some(true), "{report}");
    let data = &report["data"];
    has_fields(
        data,
        &["range", "totalSeconds", "entryCount", "activeDays", "projects", "days", "weeks", "overlaps", "entries"],
        "report",
    );
    has_fields(&data["range"], &["fromDay", "toDay", "timezone", "weekStartsOn"], "report range");
    let projects = data["projects"].as_array().expect("projects");
    assert!(!projects.is_empty(), "{report}");
    for project in projects {
        has_fields(project, &["projectId", "name", "clientName", "totalSeconds", "entryCount"], "report projects");
    }
    let days = data["days"].as_array().expect("days");
    assert!(!days.is_empty(), "{report}");
    for day in days {
        has_fields(day, &["day", "totalSeconds", "projects"], "report days");
    }
    for week in data["weeks"].as_array().expect("weeks") {
        has_fields(week, &["fromDay", "toDay", "totalSeconds", "projects"], "report weeks");
    }
    for entry in data["entries"].as_array().expect("entries") {
        has_fields(
            entry,
            &["id", "title", "projectId", "start", "stop", "localDay", "seconds", "kind", "overlapping", "blockIds"],
            "report entries",
        );
    }
}

#[test]
fn tally_reports_the_jira_status_the_reports_window_merges() {
    let Some(sandbox) = Sandbox::new(&["bita", "tally"], "status") else { return };
    if !sandbox.declares("tally", "timesheet.status") && lacks_command(&sandbox.run("tally", &["status", "today"])) {
        eprintln!("skipped: this tally has no status command");
        return;
    }
    log_a_past_block(&sandbox);

    let status = sandbox.run("tally", &["status", "--from", REPORT_FROM, "--to", REPORT_TO, "--entries", "--include-running"]);
    assert_eq!(status["ok"].as_bool(), Some(true), "{status}");
    let data = &status["data"];
    has_fields(data, &["projects", "totals", "entries"], "tally status");
    has_fields(
        &data["totals"],
        &["registeredSeconds", "pendingSeconds", "excludedSeconds", "nonJiraSeconds"],
        "tally status totals",
    );
    let projects = data["projects"].as_array().expect("projects");
    assert!(!projects.is_empty(), "{status}");
    for project in projects {
        has_fields(
            project,
            &["projectId", "name", "jira", "registeredSeconds", "pendingSeconds", "excludedSeconds", "nonJiraSeconds"],
            "tally status projects",
        );
    }
    for entry in data["entries"].as_array().expect("entries") {
        has_fields(entry, &["entryId", "registered", "issueKey", "jira", "excludedReason", "projectId", "localDay", "seconds"], "tally status entries");
    }
}
