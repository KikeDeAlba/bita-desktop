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
    tool: String,
    bin: Vec<String>,
    root: PathBuf,
}

impl Sandbox {
    fn new(tool: &str, name: &str) -> Option<Self> {
        let Some(bin) = registered_bin(tool) else {
            eprintln!("skipped: {tool} is not in the sandbox registry ({REGISTRY_ENV})");
            return None;
        };
        let root = env::temp_dir().join(format!("den-contract-{tool}-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("home")).expect("sandbox home");
        Some(Self { tool: tool.to_string(), bin, root })
    }

    fn path(&self) -> OsString {
        let mut parts: Vec<PathBuf> = Vec::new();
        if let Some(parent) = Path::new(&self.bin[0]).parent() {
            parts.push(parent.to_path_buf());
        }
        parts.extend(env::split_paths(&env::var_os("PATH").unwrap_or_default()));
        env::join_paths(parts).unwrap_or_default()
    }

    fn run(&self, args: &[&str], stdin: Option<&str>) -> serde_json::Value {
        use std::io::Write;
        let mut command = Command::new(&self.bin[0]);
        command.args(&self.bin[1..]).args(args).arg("--json");
        if self.tool == "bita" {
            command
                .arg("--db-path")
                .arg(self.root.join("bita.db"))
                .arg("--docs-dir")
                .arg(self.root.join("docs"));
        }
        let mut child = command
            .current_dir(&self.root)
            .env_clear()
            .env("PATH", self.path())
            .env("HOME", self.root.join("home"))
            .env("XDG_CONFIG_HOME", self.root.join("home/.config"))
            .env("XDG_DATA_HOME", self.root.join("home/.local/share"))
            .env("XDG_STATE_HOME", self.root.join("home/.local/state"))
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
            .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("run the registered tool");
        if let Some(text) = stdin {
            let mut pipe = child.stdin.take().expect("stdin");
            pipe.write_all(text.as_bytes()).expect("write stdin");
        }
        let output = child.wait_with_output().expect("wait for the tool");
        let stdout = String::from_utf8_lossy(&output.stdout);
        let line = stdout.trim().lines().last().unwrap_or_default().to_string();
        serde_json::from_str(&line).unwrap_or_else(|_| {
            panic!(
                "{} {args:?} did not print one JSON document: {stdout} {}",
                self.tool,
                String::from_utf8_lossy(&output.stderr)
            )
        })
    }
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
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
        let Some(sandbox) = Sandbox::new(tool, "capabilities") else { continue };
        let envelope = sandbox.run(&["capabilities"], None);
        assert_eq!(envelope["ok"].as_bool(), Some(true), "{tool}: {envelope}");
        assert_eq!(envelope["data"]["name"].as_str(), Some(tool), "{envelope}");
        assert!(envelope["data"]["capabilities"].is_array(), "{envelope}");
    }
}

#[test]
fn bita_still_speaks_the_schema_this_app_understands() {
    let Some(sandbox) = Sandbox::new("bita", "schema") else { return };
    let envelope = sandbox.run(&["ls"], None);
    assert_eq!(
        envelope["schemaVersion"].as_u64(),
        Some(EXPECTED_SCHEMA),
        "bita changed its envelope version; the app's model has to change with it"
    );
    assert_eq!(envelope["ok"].as_bool(), Some(true));
    assert!(envelope["data"].is_array());
}

#[test]
fn bita_still_resolves_the_seven_sections() {
    let Some(sandbox) = Sandbox::new("bita", "sections") else { return };
    let envelope = sandbox.run(&["docs", "tree"], None);
    assert_eq!(envelope["ok"].as_bool(), Some(true), "bita docs tree failed: {envelope}");
    let sections: Vec<String> = envelope["meta"]["sections"]
        .as_array()
        .expect("meta.sections is the canonical list")
        .iter()
        .map(|value| value.as_str().unwrap_or_default().to_string())
        .collect();
    assert_eq!(
        sections,
        vec!["Contexto", "Qué se hizo", "Decisiones", "Hallazgos", "Verificación", "Pendiente", "Tocado"],
        "bita changed the canonical sections; the reader paints them by this order"
    );
}

#[test]
fn bita_lists_the_backlog_the_app_paints() {
    let Some(sandbox) = Sandbox::new("bita", "backlog") else { return };
    let run = |args: &[&str]| sandbox.run(args, None);

    let project = run(&["project", "add", "Contrato"]);
    assert_eq!(project["ok"].as_bool(), Some(true), "{project}");

    let added = run(&["backlog", "add", "--kind", "pending", "--title", "Rotar el secreto", "--project", "Contrato"]);
    assert_eq!(added["ok"].as_bool(), Some(true), "{added}");
    let id = added["data"]["id"].as_i64().expect("the new item has an id").to_string();
    assert_eq!(added["data"]["key"].as_str(), Some("CON-1"), "{added}");

    let resolved = run(&["backlog", "resolve", "CON-1", "--resolution", "Rotado"]);
    assert_eq!(resolved["data"]["status"].as_str(), Some("resolved"));
    let reopened = run(&["backlog", "reopen", &id]);
    assert_eq!(reopened["data"]["status"].as_str(), Some("open"));
    let edited = run(&["backlog", "edit", &id, "--kind", "finding"]);
    assert_eq!(edited["data"]["kind"].as_str(), Some("finding"));

    let listed = run(&["backlog", "ls", "--status", "all"]);
    let item = &listed["data"][0];
    for field in [
        "id", "key", "projectKey", "kind", "status", "title", "body", "projectName", "pageId", "pageTitle",
        "updatedAt", "resolution", "source", "createdAt",
    ] {
        assert!(item.get(field).is_some(), "backlog items lost {field}: {item}");
    }
}

#[test]
fn bita_reports_projects_outside_jira_apart() {
    let Some(sandbox) = Sandbox::new("bita", "jira") else { return };
    let run = |args: &[&str]| sandbox.run(args, None);

    assert_eq!(run(&["project", "add", "Con Jira"])["ok"].as_bool(), Some(true));
    let outside = run(&["project", "add", "Sin Jira", "--no-jira"]);
    assert_eq!(outside["data"]["jira"].as_bool(), Some(false), "{outside}");

    for (title, project) in [("Algo para Jira", "Con Jira"), ("Algo fuera", "Sin Jira")] {
        let logged = run(&["log", title, "--project", project, "--from", "00:10", "--for", "30m"]);
        assert_eq!(logged["ok"].as_bool(), Some(true), "{logged}");
    }

    let pending = run(&["summary", "--pending"]);
    assert_eq!(pending["schemaVersion"].as_u64(), Some(EXPECTED_SCHEMA));
    let groups = pending["data"]["groups"].as_array().expect("groups");
    assert!(groups.iter().all(|group| group["jira"].as_bool() == Some(true)), "{pending}");
    assert_eq!(pending["meta"]["nonJira"]["totalSeconds"].as_i64(), Some(1800), "{pending}");
}

#[test]
fn inkwell_answers_the_docs_contract() {
    let Some(sandbox) = Sandbox::new("inkwell", "contract") else { return };
    let capabilities = sandbox.run(&["capabilities"], None);
    let declared: Vec<&str> = capabilities["data"]["capabilities"]
        .as_array()
        .expect("capabilities")
        .iter()
        .filter_map(|value| value.as_str())
        .collect();
    assert!(declared.contains(&"docs.page.read"), "{capabilities}");

    let migrated = sandbox.run(&["migrate", "status"], None);
    assert_eq!(migrated["ok"].as_bool(), Some(true), "{migrated}");
    assert!(migrated["data"]["migrated"].is_boolean(), "{migrated}");

    let tree = sandbox.run(&["tree", "--pages"], None);
    assert_eq!(tree["ok"].as_bool(), Some(true), "{tree}");
    assert!(tree["data"]["spaces"].is_array(), "{tree}");
}

#[test]
fn bita_searches_by_page() {
    let Some(sandbox) = Sandbox::new("bita", "pages") else { return };
    assert_eq!(sandbox.run(&["project", "add", "Contrato"], None)["ok"].as_bool(), Some(true));
    let page = sandbox.run(&["docs", "page", "new", "Kernel compartido", "--project", "Contrato"], None);
    assert_eq!(page["ok"].as_bool(), Some(true), "{page}");
    let page_id = page["data"]["page"]["pageId"]
        .as_i64()
        .or_else(|| page["data"]["pageId"].as_i64())
        .expect("the new page has an id");
    let markdown = sandbox.root.join("body.md");
    fs::write(&markdown, "## Contexto\n\nLa paridad del kernel compartido exige la misma rama.\n").expect("body");
    let wrote = sandbox.run(
        &["docs", "page", "write", &page_id.to_string(), "--md", &markdown.display().to_string()],
        None,
    );
    assert_eq!(wrote["ok"].as_bool(), Some(true), "{wrote}");

    let found = sandbox.run(&["docs", "search", "paridad", "--pages", "--project", "Contrato"], None);
    assert_eq!(found["schemaVersion"].as_u64(), Some(EXPECTED_SCHEMA));
    assert_eq!(found["ok"].as_bool(), Some(true), "{found}");
    let hit = &found["data"][0];
    for field in [
        "pageId", "title", "projectId", "projectName", "projectSlug", "relPath", "ancestors", "matchCount",
        "sources", "matches",
    ] {
        assert!(hit.get(field).is_some(), "page hits lost {field}: {hit}");
    }
    assert!(hit["sources"].get("page").is_some() && hit["sources"].get("entries").is_some(), "{hit}");
    let first = &hit["matches"][0];
    for field in ["source", "section", "line", "prefix", "match", "suffix"] {
        assert!(first.get(field).is_some(), "page matches lost {field}: {first}");
    }
}

#[test]
fn bita_keeps_atlassian_settings_per_space() {
    let Some(sandbox) = Sandbox::new("bita", "atlassian") else { return };
    assert_eq!(sandbox.run(&["project", "add", "Contrato"], None)["ok"].as_bool(), Some(true));
    let page = sandbox.run(&["docs", "page", "new", "Kernel compartido", "--project", "Contrato"], None);
    assert_eq!(page["ok"].as_bool(), Some(true), "{page}");
    let set = sandbox.run(
        &[
            "project", "atlassian", "Contrato", "--via", "cli", "--confluence", "STI", "--pull", "on", "--push", "off",
        ],
        None,
    );
    assert_eq!(set["ok"].as_bool(), Some(true), "{set}");

    let tree = sandbox.run(&["docs", "tree", "--pages", "--months"], None);
    let space = tree["data"]["spaces"]
        .as_array()
        .expect("spaces")
        .iter()
        .find(|space| space["projectName"].as_str() == Some("Contrato"))
        .cloned()
        .expect("the space is listed");
    let atlassian = &space["atlassian"];
    assert_eq!(atlassian["via"].as_str(), Some("cli"), "{space}");
    assert_eq!(atlassian["sync"]["pull"].as_bool(), Some(true), "{space}");
    assert_eq!(atlassian["sync"]["push"].as_bool(), Some(false), "{space}");
    assert!(atlassian["sync"].get("lastSyncAt").is_some(), "{space}");
    assert_eq!(atlassian["confluence"]["kind"].as_str(), Some("space"), "{space}");
    assert_eq!(atlassian["confluence"]["spaceKey"].as_str(), Some("STI"), "{space}");

    let status = sandbox.run(&["confluence", "sync", "status", "Contrato"], None);
    assert_eq!(status["ok"].as_bool(), Some(true), "{status}");
    assert!(status["data"].is_array(), "{status}");
}

#[test]
fn bita_lists_atlassian_sites() {
    let Some(sandbox) = Sandbox::new("bita", "sites") else { return };
    let listed = sandbox.run(&["atlassian", "site", "ls"], None);
    assert_eq!(listed["schemaVersion"].as_u64(), Some(EXPECTED_SCHEMA));
    assert_eq!(listed["ok"].as_bool(), Some(true), "{listed}");
    assert!(listed["data"].is_array(), "{listed}");
    for site in listed["data"].as_array().expect("sites") {
        for field in ["site", "email", "tokenStored", "jira", "confluence", "projects", "status"] {
            assert!(site.get(field).is_some(), "sites lost {field}: {site}");
        }
    }
}

#[test]
fn bita_lists_project_repos() {
    let Some(sandbox) = Sandbox::new("bita", "repos") else { return };
    assert_eq!(sandbox.run(&["project", "add", "Contrato"], None)["ok"].as_bool(), Some(true));
    let listed = sandbox.run(&["project", "repo", "ls", "--project", "Contrato"], None);
    assert_eq!(listed["schemaVersion"].as_u64(), Some(EXPECTED_SCHEMA));
    assert_eq!(listed["ok"].as_bool(), Some(true), "{listed}");
    let repos = listed["data"]["repos"].as_array().expect("repos");
    for repo in repos {
        for field in ["project", "path", "slug", "source", "addedAt", "lastSeenAt", "exists"] {
            assert!(repo.get(field).is_some(), "repos lost {field}: {repo}");
        }
    }
}

#[test]
fn bita_keeps_the_history_of_a_page() {
    let Some(sandbox) = Sandbox::new("bita", "history") else { return };
    assert_eq!(sandbox.run(&["project", "add", "Contrato"], None)["ok"].as_bool(), Some(true));
    let page = sandbox.run(&["docs", "page", "new", "Kernel compartido", "--project", "Contrato"], None);
    assert_eq!(page["ok"].as_bool(), Some(true), "{page}");
    let page_id = page["data"]["page"]["pageId"]
        .as_i64()
        .or_else(|| page["data"]["pageId"].as_i64())
        .expect("the new page has an id");
    for body in ["## Contexto\n\nPrimera versión.\n", "## Contexto\n\nSegunda versión.\n"] {
        let markdown = sandbox.root.join("body.md");
        fs::write(&markdown, body).expect("body");
        let wrote = sandbox.run(
            &["docs", "page", "write", &page_id.to_string(), "--md", &markdown.display().to_string()],
            None,
        );
        assert_eq!(wrote["ok"].as_bool(), Some(true), "{wrote}");
    }

    let history = sandbox.run(&["docs", "page", "history", &page_id.to_string()], None);
    assert_eq!(history["ok"].as_bool(), Some(true), "{history}");
    assert_eq!(history["data"]["pageId"].as_i64(), Some(page_id), "{history}");
    let revisions = history["data"]["revisions"].as_array().expect("revisions");
    assert!(revisions.len() >= 2, "{history}");
    for revision in revisions {
        for field in ["sha", "date", "subject", "source", "reason", "entryId"] {
            assert!(revision.get(field).is_some(), "revisions lost {field}: {revision}");
        }
    }

    let oldest = revisions.last().and_then(|revision| revision["sha"].as_str()).expect("sha");
    let diff = sandbox.run(&["docs", "page", "diff", &page_id.to_string(), oldest], None);
    assert_eq!(diff["ok"].as_bool(), Some(true), "{diff}");
    for field in ["pageId", "from", "to", "diff", "hunks"] {
        assert!(diff["data"].get(field).is_some(), "page diff lost {field}: {diff}");
    }
}
