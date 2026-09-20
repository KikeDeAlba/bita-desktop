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
    let home = env::var_os("HOME").map(PathBuf::from)?;
    let mut candidates: Vec<PathBuf> = Vec::new();

    for root in [
        home.join(".nvm/versions/node"),
        home.join(".local/share/fnm/node-versions"),
    ] {
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
