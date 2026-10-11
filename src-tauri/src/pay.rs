use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::model::{Problem, ProblemKind};
use crate::report::TallyStatus;

const PAY_FILE: &str = "pay.json";
const DEFAULT_CURRENCY: &str = "MXN";
const DEFAULT_MONTHLY_HOURS: f64 = 160.0;
const DEFAULT_MULTIPLIER: f64 = 2.0;
const MAX_CURRENCY_LENGTH: usize = 8;
pub const UPGRADE_TALLY_OVERTIME: &str = "Actualiza tally a 0.4 para calcular horas extra";

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Pay {
    pub monthly_salary: Option<f64>,
    pub currency: String,
    pub monthly_hours: f64,
    pub multiplier: f64,
    pub excluded_projects: Vec<i64>,
}

impl Default for Pay {
    fn default() -> Self {
        Self {
            monthly_salary: None,
            currency: DEFAULT_CURRENCY.to_string(),
            monthly_hours: DEFAULT_MONTHLY_HOURS,
            multiplier: DEFAULT_MULTIPLIER,
            excluded_projects: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MonthSpec {
    pub month: String,
    pub from: NaiveDate,
    pub to: NaiveDate,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OvertimeProject {
    pub project_id: Option<i64>,
    pub name: Option<String>,
    pub estimate_seconds: i64,
    pub counts: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OvertimeMonth {
    pub month: String,
    pub from: String,
    pub to: String,
    pub partial: bool,
    pub estimate_seconds: i64,
    pub expected_seconds: i64,
    pub overtime_seconds: i64,
    pub pay_x1: f64,
    pub pay_multiplied: f64,
    pub by_project: Vec<OvertimeProject>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OvertimeTotals {
    pub estimate_seconds: i64,
    pub expected_seconds: i64,
    pub overtime_seconds: i64,
    pub pay_x1: f64,
    pub pay_multiplied: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Overtime {
    pub currency: String,
    pub hourly_rate: f64,
    pub multiplier: f64,
    pub monthly_hours: f64,
    pub months: Vec<OvertimeMonth>,
    pub totals: OvertimeTotals,
    pub problem: Option<String>,
}

fn invalid(message: impl Into<String>) -> Problem {
    Problem::new(ProblemKind::CliFailed, message)
}

pub fn validate(pay: Pay) -> Result<Pay, Problem> {
    if let Some(salary) = pay.monthly_salary {
        if !salary.is_finite() || salary < 0.0 {
            return Err(invalid("El sueldo mensual debe ser un número mayor o igual a 0."));
        }
    }
    if !pay.monthly_hours.is_finite() || pay.monthly_hours <= 0.0 {
        return Err(invalid("Las horas esperadas al mes deben ser mayores a 0."));
    }
    if !pay.multiplier.is_finite() || pay.multiplier < 1.0 {
        return Err(invalid("El multiplicador debe ser 1 o mayor."));
    }
    let currency = pay.currency.trim().to_uppercase();
    if currency.is_empty()
        || currency.chars().count() > MAX_CURRENCY_LENGTH
        || !currency.chars().all(|c| c.is_ascii_alphanumeric())
    {
        return Err(invalid("La moneda debe ser un código como MXN o USD."));
    }
    let mut seen = HashSet::new();
    let excluded_projects = pay.excluded_projects.into_iter().filter(|id| seen.insert(*id)).collect();
    Ok(Pay { currency, excluded_projects, ..pay })
}

fn sanitize(pay: Pay) -> Pay {
    let defaults = Pay::default();
    let field = |candidate: Pay| validate(candidate).is_ok();
    Pay {
        monthly_salary: pay
            .monthly_salary
            .filter(|_| field(Pay { monthly_salary: pay.monthly_salary, ..Pay::default() })),
        currency: if field(Pay { currency: pay.currency.clone(), ..Pay::default() }) {
            pay.currency.clone()
        } else {
            defaults.currency
        },
        monthly_hours: if field(Pay { monthly_hours: pay.monthly_hours, ..Pay::default() }) {
            pay.monthly_hours
        } else {
            defaults.monthly_hours
        },
        multiplier: if field(Pay { multiplier: pay.multiplier, ..Pay::default() }) {
            pay.multiplier
        } else {
            defaults.multiplier
        },
        excluded_projects: pay.excluded_projects,
    }
}

pub fn read_pay(path: &Path) -> Pay {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Pay>(&text).ok())
        .and_then(|pay| validate(sanitize(pay)).ok())
        .unwrap_or_default()
}

pub fn write_pay(path: &Path, pay: &Pay) -> Result<(), Problem> {
    let unwritable = |error: std::io::Error| {
        Problem::new(ProblemKind::Unreadable, format!("No pude guardar {}: {error}", path.display()))
    };
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)
            .map_err(|error| Problem::new(ProblemKind::Unreadable, format!("No pude crear {}: {error}", dir.display())))?;
    }
    let text = serde_json::to_string_pretty(pay).unwrap_or_else(|_| "{}".into());
    let temp = path.with_extension(format!("json.{}.tmp", std::process::id()));
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let written = options.open(&temp).and_then(|mut file| {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(fs::Permissions::from_mode(0o600))?;
        }
        file.write_all(text.as_bytes())?;
        file.sync_all()
    });
    if let Err(error) = written.and_then(|_| fs::rename(&temp, path)) {
        let _ = fs::remove_file(&temp);
        return Err(unwritable(error));
    }
    Ok(())
}

fn pay_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(PAY_FILE))
}

pub fn stored_pay(app: &AppHandle) -> Pay {
    pay_path(app).map(|path| read_pay(&path)).unwrap_or_default()
}

#[tauri::command]
pub fn get_pay(app: AppHandle) -> Pay {
    stored_pay(&app)
}

#[tauri::command]
pub fn set_pay(app: AppHandle, pay: Pay) -> Result<Pay, Problem> {
    let pay = validate(pay)?;
    let path = pay_path(&app)
        .ok_or_else(|| Problem::new(ProblemKind::Unreadable, "No sé dónde guardar los ajustes de pago."))?;
    write_pay(&path, &pay)?;
    Ok(pay)
}

fn month_start(day: NaiveDate) -> NaiveDate {
    day.with_day(1).unwrap_or(day)
}

fn month_end(day: NaiveDate) -> NaiveDate {
    let (year, month) = if day.month() == 12 { (day.year() + 1, 1) } else { (day.year(), day.month() + 1) };
    NaiveDate::from_ymd_opt(year, month, 1).and_then(|next| next.pred_opt()).unwrap_or(day)
}

pub fn months_between(from: NaiveDate, to: NaiveDate, today: NaiveDate) -> Vec<MonthSpec> {
    let mut months = Vec::new();
    if to < from {
        return months;
    }
    let mut start = month_start(from);
    while start <= to && start <= today {
        let end = month_end(start).min(today);
        months.push(MonthSpec { month: start.format("%Y-%m").to_string(), from: start, to: end });
        match month_end(start).succ_opt() {
            Some(next) => start = next,
            None => break,
        }
    }
    months
}

fn round_money(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn has_estimates(status: &TallyStatus) -> bool {
    status.totals.estimate_seconds.is_some() || status.projects.iter().any(|project| project.estimate_seconds.is_some())
}

impl Overtime {
    pub fn empty(pay: &Pay) -> Self {
        Self {
            currency: pay.currency.clone(),
            hourly_rate: pay.monthly_salary.unwrap_or(0.0) / pay.monthly_hours,
            multiplier: pay.multiplier,
            monthly_hours: pay.monthly_hours,
            months: Vec::new(),
            totals: OvertimeTotals::default(),
            problem: None,
        }
    }

    pub fn with_problem(pay: &Pay, problem: impl Into<String>) -> Self {
        Self { problem: Some(problem.into()), ..Self::empty(pay) }
    }
}

pub fn overtime(months: Vec<(MonthSpec, TallyStatus)>, pay: &Pay, today: NaiveDate) -> Overtime {
    let mut result = Overtime::empty(pay);
    let hourly_rate = result.hourly_rate;
    if months.iter().any(|(_, status)| !has_estimates(status)) {
        result.problem = Some(UPGRADE_TALLY_OVERTIME.to_string());
        return result;
    }
    let excluded: HashSet<i64> = pay.excluded_projects.iter().copied().collect();
    let expected_seconds = (pay.monthly_hours * 3600.0).round() as i64;
    for (spec, status) in months {
        let by_project: Vec<OvertimeProject> = status
            .projects
            .iter()
            .map(|project| OvertimeProject {
                project_id: project.project_id,
                name: project.name.clone(),
                estimate_seconds: project.estimate_seconds.unwrap_or(0),
                counts: project.jira && !project.project_id.is_some_and(|id| excluded.contains(&id)),
            })
            .collect();
        let estimate_seconds: i64 =
            by_project.iter().filter(|project| project.counts).map(|project| project.estimate_seconds).sum();
        let overtime_seconds = (estimate_seconds - expected_seconds).max(0);
        let pay_x1 = round_money(overtime_seconds as f64 / 3600.0 * hourly_rate);
        let pay_multiplied = round_money(overtime_seconds as f64 / 3600.0 * hourly_rate * pay.multiplier);
        let partial = spec.from <= today && today < month_end(spec.from);
        result.totals.estimate_seconds += estimate_seconds;
        result.totals.expected_seconds += expected_seconds;
        result.totals.overtime_seconds += overtime_seconds;
        result.totals.pay_x1 = round_money(result.totals.pay_x1 + pay_x1);
        result.totals.pay_multiplied = round_money(result.totals.pay_multiplied + pay_multiplied);
        result.months.push(OvertimeMonth {
            month: spec.month,
            from: spec.from.format("%Y-%m-%d").to_string(),
            to: spec.to.format("%Y-%m-%d").to_string(),
            partial,
            estimate_seconds,
            expected_seconds,
            overtime_seconds,
            pay_x1,
            pay_multiplied,
            by_project,
        });
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(value: &str) -> NaiveDate {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").expect("day")
    }

    fn pay() -> Pay {
        Pay { monthly_salary: Some(16000.0), excluded_projects: vec![9], ..Pay::default() }
    }

    fn status(projects: serde_json::Value) -> TallyStatus {
        let totals: i64 = projects
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|project| project["estimateSeconds"].as_i64())
            .sum();
        serde_json::from_value(serde_json::json!({
            "projects": projects,
            "totals": {"estimateSeconds": totals}
        }))
        .expect("status")
    }

    fn month(name: &str, from: &str, to: &str) -> MonthSpec {
        MonthSpec { month: name.to_string(), from: day(from), to: day(to) }
    }

    const HOUR: i64 = 3600;

    #[test]
    fn defaults_follow_the_contract() {
        let pay: Pay = serde_json::from_str("{}").expect("pay");
        assert_eq!(pay, Pay::default());
        assert_eq!(pay.currency, "MXN");
        assert_eq!(pay.monthly_hours, 160.0);
        assert_eq!(pay.multiplier, 2.0);
        assert!(pay.monthly_salary.is_none());
        let json = serde_json::to_value(&pay).expect("json");
        assert!(json.get("monthlySalary").is_some() && json.get("excludedProjects").is_some());
    }

    #[test]
    fn validation_rejects_bad_numbers() {
        assert!(validate(Pay { monthly_salary: Some(-1.0), ..Pay::default() }).is_err());
        assert!(validate(Pay { monthly_salary: Some(f64::NAN), ..Pay::default() }).is_err());
        assert!(validate(Pay { monthly_hours: 0.0, ..Pay::default() }).is_err());
        assert!(validate(Pay { multiplier: 0.5, ..Pay::default() }).is_err());
        assert!(validate(Pay { currency: " ".into(), ..Pay::default() }).is_err());
        let ok = validate(Pay {
            monthly_salary: Some(0.0),
            currency: " usd ".into(),
            multiplier: 1.0,
            excluded_projects: vec![3, 3, 4],
            ..Pay::default()
        })
        .expect("valid");
        assert_eq!(ok.currency, "USD");
        assert_eq!(ok.excluded_projects, vec![3, 4]);
    }

    #[test]
    fn pay_round_trips_through_a_private_file() {
        let dir = std::env::temp_dir().join(format!("den-pay-test-{}", std::process::id()));
        let path = dir.join(PAY_FILE);
        assert_eq!(read_pay(&path), Pay::default());
        write_pay(&path, &pay()).expect("write");
        assert_eq!(read_pay(&path), pay());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&path).expect("meta").permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
        fs::write(&path, "not json").expect("corrupt");
        assert_eq!(read_pay(&path), Pay::default());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn months_cover_each_calendar_month_of_the_range() {
        let today = day("2026-10-10");
        let months = months_between(day("2026-01-20"), day("2026-03-05"), today);
        assert_eq!(
            months,
            vec![
                month("2026-01", "2026-01-01", "2026-01-31"),
                month("2026-02", "2026-02-01", "2026-02-28"),
                month("2026-03", "2026-03-01", "2026-03-31"),
            ]
        );
        let leap = months_between(day("2028-02-10"), day("2028-02-11"), day("2028-12-31"));
        assert_eq!(leap, vec![month("2028-02", "2028-02-01", "2028-02-29")]);
        let crossing = months_between(day("2026-09-28"), day("2026-10-04"), today);
        assert_eq!(
            crossing,
            vec![month("2026-09", "2026-09-01", "2026-09-30"), month("2026-10", "2026-10-01", "2026-10-10")]
        );
        let year_end = months_between(day("2025-12-29"), day("2026-01-02"), today);
        assert_eq!(year_end[0], month("2025-12", "2025-12-01", "2025-12-31"));
        assert_eq!(year_end[1], month("2026-01", "2026-01-01", "2026-01-31"));
        assert!(months_between(day("2026-11-01"), day("2026-11-30"), today).is_empty());
        assert!(months_between(day("2026-10-05"), day("2026-10-01"), today).is_empty());
    }

    #[test]
    fn a_month_over_the_expected_hours_pays_overtime() {
        let result = overtime(
            vec![(
                month("2026-09", "2026-09-01", "2026-09-30"),
                status(serde_json::json!([{"projectId": 7, "jira": true, "estimateSeconds": 170 * HOUR}])),
            )],
            &pay(),
            day("2026-10-10"),
        );
        assert!(result.problem.is_none());
        assert_eq!(result.hourly_rate, 100.0);
        let september = &result.months[0];
        assert!(!september.partial);
        assert_eq!(september.estimate_seconds, 170 * HOUR);
        assert_eq!(september.expected_seconds, 160 * HOUR);
        assert_eq!(september.overtime_seconds, 10 * HOUR);
        assert_eq!(september.pay_x1, 1000.0);
        assert_eq!(september.pay_multiplied, 2000.0);
        assert_eq!(result.totals.pay_multiplied, 2000.0);
    }

    #[test]
    fn a_month_under_the_expected_hours_pays_nothing() {
        let result = overtime(
            vec![(
                month("2026-09", "2026-09-01", "2026-09-30"),
                status(serde_json::json!([{"projectId": 7, "jira": true, "estimateSeconds": 120 * HOUR}])),
            )],
            &pay(),
            day("2026-10-10"),
        );
        assert_eq!(result.months[0].overtime_seconds, 0);
        assert_eq!(result.months[0].pay_x1, 0.0);
        assert_eq!(result.totals.pay_multiplied, 0.0);
    }

    #[test]
    fn excluded_and_non_jira_projects_do_not_count() {
        let result = overtime(
            vec![(
                month("2026-09", "2026-09-01", "2026-09-30"),
                status(serde_json::json!([
                    {"projectId": 7, "jira": true, "estimateSeconds": 150 * HOUR},
                    {"projectId": 9, "jira": true, "estimateSeconds": 40 * HOUR},
                    {"projectId": 3, "jira": false, "estimateSeconds": 0},
                    {"projectId": 4, "jira": false, "estimateSeconds": 30 * HOUR}
                ])),
            )],
            &pay(),
            day("2026-10-10"),
        );
        let september = &result.months[0];
        assert_eq!(september.estimate_seconds, 150 * HOUR);
        assert_eq!(september.overtime_seconds, 0);
        let counts: Vec<(Option<i64>, bool)> =
            september.by_project.iter().map(|project| (project.project_id, project.counts)).collect();
        assert_eq!(counts, vec![(Some(7), true), (Some(9), false), (Some(3), false), (Some(4), false)]);
    }

    #[test]
    fn each_month_is_compared_on_its_own() {
        let result = overtime(
            vec![
                (
                    month("2026-09", "2026-09-01", "2026-09-30"),
                    status(serde_json::json!([{"projectId": 7, "jira": true, "estimateSeconds": 180 * HOUR}])),
                ),
                (
                    month("2026-10", "2026-10-01", "2026-10-10"),
                    status(serde_json::json!([{"projectId": 7, "jira": true, "estimateSeconds": 60 * HOUR}])),
                ),
            ],
            &pay(),
            day("2026-10-10"),
        );
        assert_eq!(result.months.len(), 2);
        assert!(!result.months[0].partial);
        assert!(result.months[1].partial);
        assert_eq!(result.months[0].overtime_seconds, 20 * HOUR);
        assert_eq!(result.months[1].overtime_seconds, 0);
        assert_eq!(result.totals.estimate_seconds, 240 * HOUR);
        assert_eq!(result.totals.expected_seconds, 320 * HOUR);
        assert_eq!(result.totals.overtime_seconds, 20 * HOUR);
        assert_eq!(result.totals.pay_x1, 2000.0);
        assert_eq!(result.totals.pay_multiplied, 4000.0);
    }

    #[test]
    fn the_last_day_of_the_month_closes_it() {
        let result = overtime(
            vec![(
                month("2026-02", "2026-02-01", "2026-02-28"),
                status(serde_json::json!([{"projectId": 7, "jira": true, "estimateSeconds": 0}])),
            )],
            &pay(),
            day("2026-02-28"),
        );
        assert!(!result.months[0].partial);
    }

    #[test]
    fn a_custom_multiplier_and_hours_change_the_rate() {
        let custom = Pay { monthly_salary: Some(9000.0), monthly_hours: 180.0, multiplier: 3.0, ..Pay::default() };
        let result = overtime(
            vec![(
                month("2026-08", "2026-08-01", "2026-08-31"),
                status(serde_json::json!([{"projectId": 7, "jira": true, "estimateSeconds": 182 * HOUR}])),
            )],
            &custom,
            day("2026-10-10"),
        );
        assert_eq!(result.hourly_rate, 50.0);
        assert_eq!(result.months[0].pay_x1, 100.0);
        assert_eq!(result.months[0].pay_multiplied, 300.0);
    }

    #[test]
    fn an_old_tally_without_estimates_asks_to_upgrade() {
        let old: TallyStatus = serde_json::from_value(serde_json::json!({
            "projects": [{"projectId": 7, "jira": true, "registeredSeconds": 3600}],
            "totals": {"registeredSeconds": 3600}
        }))
        .expect("old status");
        let result = overtime(vec![(month("2026-10", "2026-10-01", "2026-10-10"), old)], &pay(), day("2026-10-10"));
        assert_eq!(result.problem.as_deref(), Some(UPGRADE_TALLY_OVERTIME));
        assert!(result.months.is_empty());
    }

    #[test]
    fn the_overtime_payload_has_no_salary_field() {
        let result = overtime(Vec::new(), &pay(), day("2026-10-10"));
        let json = serde_json::to_value(&result).expect("json");
        assert!(json.get("monthlySalary").is_none());
    }

    #[test]
    fn an_invalid_field_on_disk_keeps_the_rest() {
        let dir = std::env::temp_dir().join(format!("den-pay-sanitize-{}", std::process::id()));
        let path = dir.join(PAY_FILE);
        fs::create_dir_all(&dir).expect("dir");
        fs::write(&path, r#"{"monthlySalary": 12000, "currency": "MX$", "multiplier": 0.2, "excludedProjects": [9]}"#)
            .expect("file");
        let read = read_pay(&path);
        assert_eq!(read.monthly_salary, Some(12000.0));
        assert_eq!(read.currency, "MXN");
        assert_eq!(read.multiplier, 2.0);
        assert_eq!(read.excluded_projects, vec![9]);
        let _ = fs::remove_dir_all(&dir);
    }
}
