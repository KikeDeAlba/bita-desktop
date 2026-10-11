import { invoke } from '@tauri-apps/api/core'

export interface ReportRange {
  fromDay: string
  toDay: string
  timezone: string | null
  weekStartsOn: number | string | null
}

export interface ReportProject {
  projectId: number | null
  name: string
  clientName: string | null
  totalSeconds: number
  entryCount: number
  color: string
  jira: boolean
  registeredSeconds: number
  pendingSeconds: number
}

export interface ProjectSeconds {
  projectId: number | null
  seconds: number
}

export interface ReportDay {
  day: string
  totalSeconds: number
  projects: ProjectSeconds[]
}

export interface ReportWeek {
  fromDay: string
  toDay: string
  totalSeconds: number
  projects: ProjectSeconds[]
}

export interface ReportOverlap {
  localDay: string
  trackedSeconds: number
  clockSeconds: number
  overlapSeconds: number
}

export interface ReportEntry {
  id: number
  title: string
  projectId: number | null
  start: string
  stop: string | null
  localDay: string
  seconds: number
  kind: string | null
  overlapping: boolean
  color: string
  registered: boolean | null
  issueKey: string | null
  jira: boolean | null
  excludedReason: string | null
  blockIds?: number[] | undefined
}

export interface JiraTotals {
  registeredSeconds: number
  pendingSeconds: number
  excludedSeconds: number
  nonJiraSeconds: number
}

export interface ReportView {
  range: ReportRange
  totalSeconds: number
  entryCount: number
  activeDays: number
  projects: ReportProject[]
  days: ReportDay[]
  weeks: ReportWeek[]
  overlaps: ReportOverlap[]
  entries: ReportEntry[] | null
  jiraAvailable: boolean
  jiraTotals: JiraTotals | null
  jiraProblem: string | null
}

export type RangeQuery = { preset: 'week' | 'month' } | { from: string; to: string }

export type ExportFormat = 'pdf' | 'csv' | 'xlsx' | 'md'

export type FileFormat = Exclude<ExportFormat, 'pdf'>

export type GroupBy = 'project' | 'day' | 'week'

export interface ExportInclude {
  charts: boolean
  projects: boolean
  entries: boolean
  jira: boolean
}

export function fetchReport(range: RangeQuery, projectId: number | null, entries: boolean): Promise<ReportView> {
  const args: Record<string, unknown> = { ...range, entries }
  if (projectId !== null) args['projectId'] = projectId
  return invoke<ReportView>('report', args)
}

export function exportReport(
  format: FileFormat,
  report: ReportView,
  include: ExportInclude,
  groupBy: GroupBy,
  fileName: string,
): Promise<string> {
  return invoke<string>('export_report', { format, report, include, groupBy, fileName })
}
