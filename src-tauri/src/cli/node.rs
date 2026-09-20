use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::{env, fs};

use tokio::process::Command;

pub const MIN_MAJOR: u32 = 24;

const OVERRIDE_ENV: &str = "BITA_NODE";

pub async fn discover() -> Option<PathBuf> {
    for candidate in candidates() {
        if let Some(major) = major_version(&candidate).await {
            if major >= MIN_MAJOR {
                return Some(candidate);
            }
        }
    }
    None
}

pub async fn major_version(node: &Path) -> Option<u32> {
    let output = Command::new(node)
        .arg("-p")
        .arg("process.versions.node")
        .stdin(Stdio::null())
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    text.trim().split('.').next()?.parse().ok()
}

pub fn home() -> Option<PathBuf> {
    env::var_os("HOME").map(PathBuf::from)
}

fn candidates() -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = Vec::new();

    if let Some(explicit) = env::var_os(OVERRIDE_ENV) {
        found.push(PathBuf::from(explicit));
    }

    if let Some(home) = home() {
        found.extend(managed(&home.join(".nvm/versions/node"), &["bin", "node"]));
        found.extend(managed(
            &home.join(".local/share/fnm/node-versions"),
            &["installation", "bin", "node"],
        ));
        found.extend(managed(&home.join(".asdf/installs/nodejs"), &["bin", "node"]));
        found.push(home.join(".volta/bin/node"));
        found.push(home.join("Library/pnpm/node"));
        found.push(home.join(".local/bin/node"));
    }

    found.push(PathBuf::from("/opt/homebrew/bin/node"));
    found.push(PathBuf::from("/usr/local/bin/node"));
    found.push(PathBuf::from("/usr/bin/node"));

    found.retain(|candidate| candidate.is_file());
    found.dedup();
    found
}

fn managed(root: &Path, tail: &[&str]) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };

    let mut versions: Vec<(Vec<u32>, OsString)> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name();
            let parsed = parse_version(&name.to_string_lossy())?;
            Some((parsed, name))
        })
        .collect();

    versions.sort_by(|left, right| right.0.cmp(&left.0));

    versions
        .into_iter()
        .map(|(_, name)| {
            let mut path = root.join(name);
            for part in tail {
                path = path.join(part);
            }
            path
        })
        .collect()
}

fn parse_version(name: &str) -> Option<Vec<u32>> {
    let trimmed = name.strip_prefix('v').unwrap_or(name);
    let parts: Vec<u32> = trimmed
        .split('.')
        .map(|part| part.parse::<u32>())
        .collect::<Result<_, _>>()
        .ok()?;
    if parts.is_empty() {
        None
    } else {
        Some(parts)
    }
}

#[cfg(test)]
mod tests {
    use super::parse_version;

    #[test]
    fn reads_an_nvm_directory_name() {
        assert_eq!(parse_version("v24.19.0"), Some(vec![24, 19, 0]));
    }

    #[test]
    fn reads_a_bare_version() {
        assert_eq!(parse_version("22.5.1"), Some(vec![22, 5, 1]));
    }

    #[test]
    fn rejects_anything_that_is_not_a_version() {
        assert_eq!(parse_version("node-versions"), None);
        assert_eq!(parse_version("v24.x"), None);
    }

    #[test]
    fn orders_versions_numerically_not_alphabetically() {
        let mut names = vec!["v9.0.0", "v24.19.0", "v20.11.1"];
        names.sort_by_key(|name| std::cmp::Reverse(parse_version(name).unwrap()));
        assert_eq!(names, vec!["v24.19.0", "v20.11.1", "v9.0.0"]);
    }
}
