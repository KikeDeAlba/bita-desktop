use std::time::Duration;

use serde_json::Value;
use tauri::AppHandle;
use tokio::time::{interval, sleep, MissedTickBehavior};

use crate::cli::CallOptions;
use crate::docs::Feature;
use crate::notes_cmd::payload_with;

const FIRST_RUN: Duration = Duration::from_secs(120);
const EVERY: Duration = Duration::from_secs(30 * 60);

pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        sleep(FIRST_RUN).await;
        let mut ticker = interval(EVERY);
        ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
        loop {
            ticker.tick().await;
            if wants_sync().await {
                let _ = crate::atlassian_cmd::run_sync(&app, None).await;
            }
        }
    });
}

async fn wants_sync() -> bool {
    let status = crate::registry::global().status().await;
    if crate::docs::refusal(Feature::ConfluenceSync, &status).is_some() {
        return false;
    }
    let options = CallOptions::timeout(30);
    match payload_with(Feature::Notes, &["tree", "--pages"], options).await {
        Ok(payload) => any_space_syncs(&payload.data),
        Err(_) => false,
    }
}

pub(crate) fn any_space_syncs(tree: &Value) -> bool {
    tree.get("spaces")
        .and_then(Value::as_array)
        .is_some_and(|spaces| {
            spaces.iter().any(|space| {
                let sync = &space["atlassian"]["sync"];
                sync["pull"].as_bool() == Some(true) || sync["push"].as_bool() == Some(true)
            })
        })
}

#[cfg(test)]
mod tests {
    use super::any_space_syncs;
    use serde_json::json;

    #[test]
    fn only_a_space_with_a_switch_on_asks_for_a_sync() {
        assert!(!any_space_syncs(&json!({"spaces": [{"projectSlug": "codi"}]})));
        assert!(!any_space_syncs(&json!({"spaces": [{"atlassian": {"sync": {"pull": false, "push": false}}}]})));
        assert!(any_space_syncs(&json!({"spaces": [{}, {"atlassian": {"sync": {"pull": false, "push": true}}}]})));
        assert!(!any_space_syncs(&json!({})));
    }
}
