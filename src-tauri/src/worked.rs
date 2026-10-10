use std::collections::{BTreeMap, BTreeSet, HashMap};

use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::model::{Entry, Overlap};

const OVERLAP_FLOOR_SECONDS: i64 = 60;
const UNTITLED: &str = "(sin título)";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkedGroup {
    pub summary: String,
    pub project_id: Option<i64>,
    pub project_name: Option<String>,
    pub total_seconds: i64,
    pub entry_ids: Vec<i64>,
    pub days: Vec<String>,
    pub running: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkedView {
    pub total_seconds: i64,
    pub groups: Vec<WorkedGroup>,
    pub overlaps: Vec<Overlap>,
}

pub fn grouping_key(description: &str) -> String {
    let collapsed = description.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed
        .trim_end_matches(|c: char| matches!(c, '.' | ',' | ';' | ':') || c.is_whitespace())
        .to_lowercase()
}

pub fn group(entries: &[Entry], now: DateTime<Utc>) -> WorkedView {
    let mut list: Vec<WorkedGroup> = Vec::new();
    let mut days: Vec<BTreeSet<String>> = Vec::new();
    let mut index: HashMap<(Option<i64>, String), usize> = HashMap::new();
    for entry in entries {
        let at = *index
            .entry((entry.project_id, grouping_key(&entry.description)))
            .or_insert_with(|| {
                let title = entry.description.split_whitespace().collect::<Vec<_>>().join(" ");
                list.push(WorkedGroup {
                    summary: if title.is_empty() { UNTITLED.to_string() } else { title },
                    project_id: entry.project_id,
                    project_name: entry.project_name.clone(),
                    total_seconds: 0,
                    entry_ids: Vec::new(),
                    days: Vec::new(),
                    running: false,
                });
                days.push(BTreeSet::new());
                list.len() - 1
            });
        let found = &mut list[at];
        found.total_seconds += entry.duration_seconds.max(0);
        found.entry_ids.push(entry.id);
        found.running |= entry.running;
        days[at].insert(entry.local_day.clone());
    }
    for (found, seen) in list.iter_mut().zip(days) {
        found.days = seen.into_iter().collect();
    }
    list.sort_by(|left, right| right.total_seconds.cmp(&left.total_seconds));
    WorkedView {
        total_seconds: list.iter().map(|found| found.total_seconds).sum(),
        groups: list,
        overlaps: overlaps(entries, now),
    }
}

fn seconds(milliseconds: i64) -> i64 {
    (milliseconds as f64 / 1000.0).round() as i64
}

fn union_seconds(mut intervals: Vec<(i64, i64)>) -> i64 {
    intervals.sort();
    let mut total = 0;
    let mut current: Option<(i64, i64)> = None;
    for (from, to) in intervals {
        current = match current {
            Some((start, end)) if from <= end => Some((start, end.max(to))),
            Some((start, end)) => {
                total += end - start;
                Some((from, to))
            }
            None => Some((from, to)),
        };
    }
    if let Some((start, end)) = current {
        total += end - start;
    }
    seconds(total)
}

pub fn overlaps(entries: &[Entry], now: DateTime<Utc>) -> Vec<Overlap> {
    let mut intervals: BTreeMap<String, Vec<(i64, i64)>> = BTreeMap::new();
    for entry in entries {
        let Ok(from) = DateTime::parse_from_rfc3339(&entry.start) else { continue };
        let to = match entry.stop.as_deref() {
            Some(stop) => match DateTime::parse_from_rfc3339(stop) {
                Ok(parsed) => parsed.timestamp_millis(),
                Err(_) => continue,
            },
            None => now.timestamp_millis(),
        };
        let from = from.timestamp_millis();
        if to <= from {
            continue;
        }
        intervals.entry(entry.local_day.clone()).or_default().push((from, to));
    }
    intervals
        .into_iter()
        .filter_map(|(local_day, spans)| {
            let tracked_seconds = spans.iter().map(|(from, to)| seconds(to - from)).sum::<i64>();
            let clock_seconds = union_seconds(spans);
            let overlap_seconds = tracked_seconds - clock_seconds;
            (overlap_seconds >= OVERLAP_FLOOR_SECONDS).then_some(Overlap {
                local_day,
                tracked_seconds,
                clock_seconds,
                overlap_seconds,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: i64, description: &str, project: Option<(i64, &str)>, start: &str, stop: Option<&str>, seconds: i64) -> Entry {
        Entry {
            id,
            description: description.into(),
            doc_rel_path: None,
            sections_written: None,
            sections_total: None,
            touched_since_note: None,
            project_id: project.map(|(id, _)| id),
            project_name: project.map(|(_, name)| name.to_string()),
            start: start.into(),
            stop: stop.map(str::to_string),
            start_local: start.into(),
            local_day: start[..10].into(),
            duration_seconds: seconds,
            duration_human: String::new(),
            registered: false,
            running: stop.is_none(),
            kind: None,
        }
    }

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-10-10T18:00:00Z").expect("now").with_timezone(&Utc)
    }

    #[test]
    fn blocks_with_the_same_title_and_project_become_one_task() {
        let codi = Some((7, "CoDi"));
        let entries = vec![
            entry(1, "Firma BBVA", codi, "2026-10-09T15:00:00Z", Some("2026-10-09T16:00:00Z"), 3600),
            entry(2, "firma  bbva.", codi, "2026-10-10T15:00:00Z", Some("2026-10-10T15:30:00Z"), 1800),
            entry(3, "Firma BBVA", Some((8, "DPP")), "2026-10-10T16:00:00Z", Some("2026-10-10T16:10:00Z"), 600),
            entry(4, "Revisión", None, "2026-10-10T17:00:00Z", None, 3600),
            entry(5, "  ", None, "2026-10-10T12:00:00Z", Some("2026-10-10T12:05:00Z"), 300),
        ];
        let view = group(&entries, now());
        assert_eq!(view.total_seconds, 3600 + 1800 + 600 + 3600 + 300);
        assert_eq!(view.groups.len(), 4);

        let codi = &view.groups[0];
        assert_eq!(codi.summary, "Firma BBVA");
        assert_eq!(codi.project_name.as_deref(), Some("CoDi"));
        assert_eq!(codi.total_seconds, 5400);
        assert_eq!(codi.entry_ids, vec![1, 2]);
        assert_eq!(codi.days, vec!["2026-10-09", "2026-10-10"]);
        assert!(!codi.running);

        let running = view.groups.iter().find(|found| found.summary == "Revisión").expect("running");
        assert!(running.running);
        assert_eq!(running.total_seconds, 3600);
        assert_eq!(running.project_id, None);

        let other_project = view.groups.iter().find(|found| found.project_id == Some(8)).expect("dpp");
        assert_eq!(other_project.entry_ids, vec![3]);

        assert!(view.groups.iter().any(|found| found.summary == "(sin título)"));
    }

    #[test]
    fn nothing_measured_reads_as_an_empty_view() {
        let view = group(&[], now());
        assert_eq!(view.total_seconds, 0);
        assert!(view.groups.is_empty());
        assert!(view.overlaps.is_empty());
    }

    #[test]
    fn a_running_timer_overlaps_up_to_now() {
        let entries = vec![
            entry(1, "A", None, "2026-10-10T17:00:00Z", None, 0),
            entry(2, "B", None, "2026-10-10T17:30:00Z", Some("2026-10-10T17:45:00Z"), 900),
        ];
        let found = overlaps(&entries, now());
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].tracked_seconds, 3600 + 900);
        assert_eq!(found[0].clock_seconds, 3600);
        assert_eq!(found[0].overlap_seconds, 900);
    }

    #[test]
    fn timers_running_at_once_show_up_as_an_overlap() {
        let entries = vec![
            entry(1, "A", None, "2026-10-10T15:00:00Z", Some("2026-10-10T16:00:00Z"), 3600),
            entry(2, "B", None, "2026-10-10T15:30:00Z", Some("2026-10-10T16:30:00Z"), 3600),
            entry(3, "C", None, "2026-10-09T15:00:00Z", Some("2026-10-09T15:30:00Z"), 1800),
            entry(4, "D", None, "2026-10-09T15:30:00Z", Some("2026-10-09T15:30:30Z"), 30),
        ];
        let found = overlaps(&entries, now());
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].local_day, "2026-10-10");
        assert_eq!(found[0].tracked_seconds, 7200);
        assert_eq!(found[0].clock_seconds, 5400);
        assert_eq!(found[0].overlap_seconds, 1800);
    }

    #[test]
    fn the_grouping_key_ignores_case_spacing_and_trailing_punctuation() {
        assert_eq!(grouping_key("  Firma   BBVA;. "), "firma bbva");
        assert_eq!(grouping_key("Firma BBVA"), grouping_key("firma bbva:"));
        assert_eq!(grouping_key("Firma BBVA ."), grouping_key("Firma BBVA"));
        assert_ne!(grouping_key("Firma BBVA 2"), grouping_key("Firma BBVA"));
    }
}
