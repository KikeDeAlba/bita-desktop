use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::{env, fs};

const EXPECTED_SCHEMA: u64 = 3;

fn vendored_cli() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("repository root")
        .join("vendor/bita/src/bin/bita.ts")
}

fn node() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    let home = env::var_os("HOME").map(PathBuf::from);
    let roots = match home.as_ref() {
        Some(home) => vec![home.join(".nvm/versions/node"), home.join(".local/share/fnm/node-versions")],
        None => Vec::new(),
    };

    for root in roots {
        if let Ok(entries) = fs::read_dir(&root) {
            let mut names: Vec<String> = entries
                .flatten()
                .map(|entry| entry.file_name().to_string_lossy().to_string())
                .collect();
            names.sort();
            names.reverse();
            for name in names {
                candidates.push(root.join(&name).join("bin/node"));
                candidates.push(root.join(&name).join("installation/bin/node"));
            }
        }
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin/node"));
    candidates.push(PathBuf::from("/usr/local/bin/node"));
    candidates.push(PathBuf::from("/usr/bin/node"));
    if let Some(path) = env::var_os("PATH") {
        let name = if cfg!(windows) { "node.exe" } else { "node" };
        candidates.extend(env::split_paths(&path).map(|directory| directory.join(name)));
    }

    candidates.into_iter().find(|candidate| candidate.is_file())
}

#[test]
fn the_vendored_cli_still_speaks_the_schema_this_app_understands() {
    let entry = vendored_cli();
    assert!(
        entry.is_file(),
        "the bita submodule is not checked out at {}; run git submodule update --init",
        entry.display()
    );

    let Some(node) = node() else {
        panic!("no node found; this app cannot work without one");
    };

    let database = env::temp_dir().join(format!("bita-contract-{}.db", std::process::id()));
    let _ = fs::remove_file(&database);

    let output = Command::new(&node)
        .arg(&entry)
        .arg("ls")
        .arg("--json")
        .arg("--db-path")
        .arg(&database)
        .current_dir("/")
        .stdin(Stdio::null())
        .output()
        .expect("run the vendored CLI");

    let stdout = String::from_utf8_lossy(&output.stdout);
    let envelope: serde_json::Value =
        serde_json::from_str(stdout.trim()).expect("the CLI printed one JSON document");

    assert_eq!(
        envelope["schemaVersion"].as_u64(),
        Some(EXPECTED_SCHEMA),
        "the CLI changed its envelope version; the app's model has to change with it"
    );
    assert_eq!(envelope["ok"].as_bool(), Some(true));
    assert!(envelope["data"].is_array());

    let _ = fs::remove_file(&database);
}

#[test]
fn the_vendored_cli_still_resolves_the_seven_sections() {
    let entry = vendored_cli();
    assert!(entry.is_file(), "the bita submodule is not checked out");

    let Some(node) = node() else {
        panic!("no node found; this app cannot work without one");
    };

    let database = env::temp_dir().join(format!("bita-sections-{}.db", std::process::id()));
    let _ = fs::remove_file(&database);

    let output = Command::new(&node)
        .arg(&entry)
        .arg("docs")
        .arg("tree")
        .arg("--json")
        .arg("--db-path")
        .arg(&database)
        .current_dir("/")
        .stdin(Stdio::null())
        .output()
        .expect("run the vendored CLI");

    let stdout = String::from_utf8_lossy(&output.stdout);
    let envelope: serde_json::Value =
        serde_json::from_str(stdout.trim()).expect("the CLI printed one JSON document");

    assert_eq!(envelope["ok"].as_bool(), Some(true), "bita docs tree failed");

    let sections: Vec<String> = envelope["meta"]["sections"]
        .as_array()
        .expect("meta.sections is the canonical list")
        .iter()
        .map(|value| value.as_str().unwrap_or_default().to_string())
        .collect();

    assert_eq!(
        sections,
        vec![
            "Contexto",
            "Qué se hizo",
            "Decisiones",
            "Hallazgos",
            "Verificación",
            "Pendiente",
            "Tocado",
        ],
        "the CLI changed the canonical sections; the reader paints them by this order"
    );

    let _ = fs::remove_file(&database);
}

#[test]
fn the_vendored_cli_lists_the_backlog_the_app_paints() {
    let entry = vendored_cli();
    assert!(entry.is_file(), "the bita submodule is not checked out");

    let Some(node) = node() else {
        panic!("no node found; this app cannot work without one");
    };

    let database = env::temp_dir().join(format!("bita-contract-backlog-{}.db", std::process::id()));
    let _ = fs::remove_file(&database);

    let run = |args: &[&str]| -> serde_json::Value {
        let output = Command::new(&node)
            .arg(&entry)
            .args(args)
            .arg("--json")
            .arg("--db-path")
            .arg(&database)
            .current_dir("/")
            .stdin(Stdio::null())
            .output()
            .expect("run the vendored CLI");
        let stdout = String::from_utf8_lossy(&output.stdout);
        serde_json::from_str(stdout.trim()).expect("the CLI printed one JSON document")
    };

    let project = run(&["project", "add", "Contrato"]);
    assert_eq!(project["ok"].as_bool(), Some(true), "{project}");

    let added = run(&[
        "backlog", "add", "--kind", "pending", "--title", "Rotar el secreto", "--project", "Contrato",
    ]);
    assert_eq!(added["ok"].as_bool(), Some(true), "{added}");
    let id = added["data"]["id"].as_i64().expect("the new item has an id").to_string();
    assert_eq!(added["data"]["key"].as_str(), Some("CON-1"), "{added}");

    let resolved = run(&["backlog", "resolve", "CON-1", "--resolution", "Rotado"]);
    assert_eq!(resolved["data"]["status"].as_str(), Some("resolved"));
    assert_eq!(resolved["data"]["id"].as_i64().map(|value| value.to_string()), Some(id.clone()));

    let reopened = run(&["backlog", "reopen", &id]);
    assert_eq!(reopened["data"]["status"].as_str(), Some("open"));
    let edited = run(&["backlog", "edit", &id, "--kind", "finding"]);
    assert_eq!(edited["data"]["kind"].as_str(), Some("finding"));
    let resolved = run(&["backlog", "resolve", &id]);
    assert_eq!(resolved["data"]["resolution"].as_str(), Some("Rotado"));

    let listed = run(&["backlog", "ls", "--status", "all"]);
    assert_eq!(listed["schemaVersion"].as_u64(), Some(EXPECTED_SCHEMA));
    let item = &listed["data"][0];
    for field in [
        "id", "key", "projectKey", "kind", "status", "title", "body", "projectName", "pageId",
        "pageTitle", "updatedAt", "resolution", "source", "createdAt",
    ] {
        assert!(item.get(field).is_some(), "backlog items lost {field}: {item}");
    }
    assert_eq!(listed["meta"]["counts"]["resolved"].as_u64(), Some(1));

    let _ = fs::remove_file(&database);
}

#[test]
fn the_vendored_cli_reports_projects_outside_jira_apart() {
    let entry = vendored_cli();
    assert!(entry.is_file(), "the bita submodule is not checked out");

    let Some(node) = node() else {
        panic!("no node found; this app cannot work without one");
    };

    let database = env::temp_dir().join(format!("bita-contract-jira-{}.db", std::process::id()));
    let _ = fs::remove_file(&database);

    let run = |args: &[&str]| -> serde_json::Value {
        let output = Command::new(&node)
            .arg(&entry)
            .args(args)
            .arg("--json")
            .arg("--db-path")
            .arg(&database)
            .current_dir("/")
            .env("BITA_NO_HOOKS", "1")
            .stdin(Stdio::null())
            .output()
            .expect("run the vendored CLI");
        let stdout = String::from_utf8_lossy(&output.stdout);
        serde_json::from_str(stdout.trim()).expect("the CLI printed one JSON document")
    };

    assert_eq!(run(&["project", "add", "Con Jira"])["ok"].as_bool(), Some(true));
    let outside = run(&["project", "add", "Sin Jira", "--no-jira"]);
    assert_eq!(outside["data"]["jira"].as_bool(), Some(false), "{outside}");

    let projects = run(&["projects"]);
    let flags: Vec<(String, bool)> = projects["data"]
        .as_array()
        .expect("projects")
        .iter()
        .map(|project| {
            (
                project["name"].as_str().unwrap_or_default().to_string(),
                project["jira"].as_bool().expect("every project says whether it goes to Jira"),
            )
        })
        .collect();
    assert!(flags.contains(&("Sin Jira".to_string(), false)), "{flags:?}");

    for (title, project) in [("Algo para Jira", "Con Jira"), ("Algo fuera", "Sin Jira")] {
        let logged = run(&["log", title, "--project", project, "--from", "00:10", "--for", "30m"]);
        assert_eq!(logged["ok"].as_bool(), Some(true), "{logged}");
    }

    let pending = run(&["summary", "--pending"]);
    assert_eq!(pending["schemaVersion"].as_u64(), Some(EXPECTED_SCHEMA));
    let groups = pending["data"]["groups"].as_array().expect("groups");
    assert!(groups.iter().all(|group| group["jira"].as_bool() == Some(true)), "{pending}");
    assert_eq!(pending["meta"]["nonJira"]["totalSeconds"].as_i64(), Some(1800), "{pending}");
    assert_eq!(pending["data"]["nonJiraSeconds"].as_i64(), Some(1800), "{pending}");

    let _ = fs::remove_file(&database);
}

const ALTERNATIVE_CLI_ENV: &str = "BITA_CONTRACT_CLI";

struct Sandbox {
    node: PathBuf,
    entry: PathBuf,
    root: PathBuf,
}

impl Sandbox {
    fn new(name: &str) -> Option<Self> {
        let entry = PathBuf::from(env::var_os(ALTERNATIVE_CLI_ENV)?);
        assert!(entry.is_file(), "{ALTERNATIVE_CLI_ENV} points at {} which is not a file", entry.display());
        let node = node().expect("no node found; this app cannot work without one");
        let root = env::temp_dir().join(format!("bita-contract-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("home")).expect("sandbox home");
        Some(Self { node, entry, root })
    }

    fn run(&self, args: &[&str], stdin: Option<&str>) -> serde_json::Value {
        use std::io::Write;
        let mut child = Command::new(&self.node)
            .arg(&self.entry)
            .args(args)
            .arg("--json")
            .arg("--db-path")
            .arg(self.root.join("bita.db"))
            .arg("--docs-dir")
            .arg(self.root.join("docs"))
            .current_dir("/")
            .env("HOME", self.root.join("home"))
            .env("XDG_CONFIG_HOME", self.root.join("home/.config"))
            .env("XDG_DATA_HOME", self.root.join("home/.local/share"))
            .env("BITA_NO_HOOKS", "1")
            .env("GIT_AUTHOR_NAME", "bita contract")
            .env("GIT_AUTHOR_EMAIL", "contract@bita.invalid")
            .env("GIT_COMMITTER_NAME", "bita contract")
            .env("GIT_COMMITTER_EMAIL", "contract@bita.invalid")
            .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("run the alternative CLI");
        if let Some(text) = stdin {
            let mut pipe = child.stdin.take().expect("stdin");
            pipe.write_all(text.as_bytes()).expect("write stdin");
        }
        let output = child.wait_with_output().expect("wait for the CLI");
        let stdout = String::from_utf8_lossy(&output.stdout);
        serde_json::from_str(stdout.trim()).unwrap_or_else(|_| {
            panic!(
                "{args:?} did not print one JSON document: {stdout} {}",
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
fn the_new_cli_searches_by_page() {
    let Some(sandbox) = Sandbox::new("pages") else { return };
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
fn the_new_cli_keeps_atlassian_settings_per_space() {
    let Some(sandbox) = Sandbox::new("atlassian") else { return };
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
fn the_new_cli_lists_atlassian_sites() {
    let Some(sandbox) = Sandbox::new("sites") else { return };
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
fn the_new_cli_lists_project_repos() {
    let Some(sandbox) = Sandbox::new("repos") else { return };
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
fn the_new_cli_keeps_the_history_of_a_page() {
    let Some(sandbox) = Sandbox::new("history") else { return };
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
