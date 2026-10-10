use serde_json::Value;

use crate::cli::{CallOptions, Cli};
use crate::model::{Problem, ProblemKind};
use crate::registry::{self, DocsProvider, Modules, Tool, ToolsStatus};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scope {
    Pages,
    EntryNotes,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Feature {
    Notes,
    Backlog,
    History,
    ConfluenceSync,
    Proposals,
    Meetings,
    Atlassian,
}

impl Feature {
    fn enabled(self, modules: &Modules) -> bool {
        match self {
            Feature::Notes => modules.notes,
            Feature::Backlog => modules.backlog,
            Feature::History => modules.history,
            Feature::ConfluenceSync => modules.confluence_sync,
            Feature::Proposals => modules.proposals,
            Feature::Meetings => modules.meetings,
            Feature::Atlassian => modules.atlassian,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Feature::Notes => "leer las notas",
            Feature::Backlog => "el backlog",
            Feature::History => "el historial de las páginas",
            Feature::ConfluenceSync => "sincronizar con Confluence",
            Feature::Proposals => "los cambios propuestos",
            Feature::Meetings => "las reuniones",
            Feature::Atlassian => "las conexiones con Atlassian",
        }
    }

    fn provider(self) -> Tool {
        match self {
            Feature::Notes | Feature::Backlog | Feature::History | Feature::ConfluenceSync => Tool::Inkwell,
            Feature::Proposals | Feature::Meetings => Tool::Recap,
            Feature::Atlassian => Tool::Atl,
        }
    }
}

pub fn refusal(feature: Feature, status: &ToolsStatus) -> Option<Problem> {
    if feature.enabled(&status.modules) {
        return None;
    }
    let tool = match feature {
        Feature::Proposals if status.modules.meetings => Tool::Inkwell,
        other => other.provider(),
    };
    let present = status.tool(tool).is_some_and(|found| found.ready());
    let hint = status
        .tool(tool)
        .map(|found| found.install.clone())
        .unwrap_or_else(|| tool.default_install());
    let message = if present {
        format!("La versión instalada de {} no ofrece {}.", tool.name(), feature.label())
    } else {
        format!("Para {} hace falta instalar {}.", feature.label(), tool.name())
    };
    Some(Problem::new(ProblemKind::ToolMissing, message).with_hint(Some(hint)))
}

pub async fn require(feature: Feature) -> Result<ToolsStatus, Problem> {
    let status = registry::global().status().await;
    match refusal(feature, &status) {
        Some(problem) => Err(problem),
        None => Ok(status),
    }
}

pub fn scope_of(args: &[&str]) -> Scope {
    match args {
        ["docs", "ls", ..] | ["docs", "show", ..] => Scope::EntryNotes,
        ["docs", "search", rest @ ..] if !rest.contains(&"--pages") => Scope::EntryNotes,
        _ => Scope::Pages,
    }
}

pub fn provider_for(scope: Scope, status: &ToolsStatus) -> Option<DocsProvider> {
    let bita = status.tool(Tool::Bita).is_some_and(|found| found.ready());
    match scope {
        Scope::EntryNotes if bita => Some(DocsProvider::Bita),
        _ => status.docs,
    }
}

pub fn inkwell_args<'a>(args: &[&'a str]) -> Vec<&'a str> {
    match args {
        ["docs", rest @ ..] => rest.to_vec(),
        ["confluence", "sync", "status", rest @ ..] => {
            let mut mapped = vec!["confluence", "status"];
            mapped.extend_from_slice(rest);
            mapped
        }
        other => other.to_vec(),
    }
}

pub async fn client(scope: Scope) -> Result<(Cli, DocsProvider), Problem> {
    let status = registry::global().status().await;
    let Some(provider) = provider_for(scope, &status) else {
        return Err(refusal(Feature::Notes, &status).unwrap_or_else(|| registry::missing_problem(Tool::Inkwell)));
    };
    Ok((Cli::for_tool(provider.tool()).await?, provider))
}

pub async fn call(args: &[&str], options: CallOptions) -> Result<(Option<Value>, Value), Problem> {
    let (cli, provider) = client(scope_of(args)).await?;
    let mapped = match provider {
        DocsProvider::Inkwell => inkwell_args(args),
        DocsProvider::Bita => args.to_vec(),
    };
    cli.call_with_options::<Value>(&mapped, options).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::registry::{ToolState, ToolStatus};

    fn status(ready: &[Tool], docs: Option<DocsProvider>, modules: Modules) -> ToolsStatus {
        ToolsStatus {
            registry_dir: "/r".into(),
            tools: registry::KNOWN
                .iter()
                .map(|tool| ToolStatus {
                    name: tool.name().into(),
                    known: true,
                    state: if ready.contains(tool) { ToolState::Ready } else { ToolState::Missing },
                    version: None,
                    capabilities: Vec::new(),
                    verified: false,
                    origin: None,
                    command: None,
                    manifest: None,
                    install: tool.default_install(),
                    purpose: None,
                })
                .collect(),
            invalid: Vec::new(),
            modules,
            docs,
            inkwell_migrated: None,
        }
    }

    #[test]
    fn the_docs_prefix_is_dropped_for_inkwell() {
        assert_eq!(inkwell_args(&["docs", "tree", "--pages"]), vec!["tree", "--pages"]);
        assert_eq!(inkwell_args(&["docs", "page", "history", "4"]), vec!["page", "history", "4"]);
        assert_eq!(inkwell_args(&["backlog", "ls", "--status", "all"]), vec!["backlog", "ls", "--status", "all"]);
        assert_eq!(inkwell_args(&["confluence", "sync", "--all"]), vec!["confluence", "sync", "--all"]);
        assert_eq!(inkwell_args(&["confluence", "sync", "status", "codi"]), vec!["confluence", "status", "codi"]);
    }

    #[test]
    fn entry_notes_stay_with_bita_and_pages_follow_the_provider() {
        assert_eq!(scope_of(&["docs", "ls", "today"]), Scope::EntryNotes);
        assert_eq!(scope_of(&["docs", "show", "7"]), Scope::EntryNotes);
        assert_eq!(scope_of(&["docs", "search", "x"]), Scope::EntryNotes);
        assert_eq!(scope_of(&["docs", "search", "x", "--pages"]), Scope::Pages);
        assert_eq!(scope_of(&["docs", "tree", "--pages"]), Scope::Pages);
        assert_eq!(scope_of(&["backlog", "ls"]), Scope::Pages);

        let both = status(&[Tool::Bita, Tool::Inkwell], Some(DocsProvider::Inkwell), Modules::default());
        assert_eq!(provider_for(Scope::EntryNotes, &both), Some(DocsProvider::Bita));
        assert_eq!(provider_for(Scope::Pages, &both), Some(DocsProvider::Inkwell));
        let inkwell = status(&[Tool::Inkwell], Some(DocsProvider::Inkwell), Modules::default());
        assert_eq!(provider_for(Scope::EntryNotes, &inkwell), Some(DocsProvider::Inkwell));
        let none = status(&[], None, Modules::default());
        assert_eq!(provider_for(Scope::Pages, &none), None);
    }

    #[test]
    fn a_feature_that_is_off_names_the_tool_to_install() {
        let none = status(&[], None, Modules::default());
        let problem = refusal(Feature::Backlog, &none).expect("refused");
        assert_eq!(problem.kind, ProblemKind::ToolMissing);
        assert!(problem.message.contains("inkwell"));
        assert_eq!(problem.hint.as_deref(), Some("npm i -g @kikedealba/inkwell && inkwell setup"));

        let old = status(&[Tool::Inkwell], Some(DocsProvider::Inkwell), Modules { notes: true, ..Modules::default() });
        let problem = refusal(Feature::History, &old).expect("refused");
        assert!(problem.message.contains("no ofrece"));

        let meetings = status(&[Tool::Recap], None, Modules { meetings: true, ..Modules::default() });
        assert!(refusal(Feature::Meetings, &meetings).is_none());
        assert!(refusal(Feature::Proposals, &meetings).expect("refused").message.contains("inkwell"));
        assert!(refusal(Feature::Atlassian, &meetings).expect("refused").message.contains("atl"));
    }
}
