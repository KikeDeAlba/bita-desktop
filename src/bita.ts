import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export const SNAPSHOT_EVENT = 'bita://snapshot'

export type ProblemKind =
  | 'node-missing'
  | 'cli-missing'
  | 'schema-mismatch'
  | 'cli-failed'
  | 'unreadable'

export interface Problem {
  kind: ProblemKind
  message: string
  hint: string | null
}

export interface LiveTimer {
  id: number
  title: string | null
  projectName: string | null
  projectId: number | null
  startedAt: string
  startLocal: string
  elapsedSeconds: number
  draft: boolean
}

export interface Snapshot {
  running: LiveTimer[]
  todaySeconds: number
  problem: Problem | null
}

export interface Project {
  id: number
  name: string
  active: boolean
  clientName: string | null
  jiraProjectKey: string | null
}

export function snapshot(): Promise<Snapshot> {
  return invoke<Snapshot>('snapshot')
}

export function refresh(): Promise<Snapshot> {
  return invoke<Snapshot>('refresh')
}

export function projects(): Promise<Project[]> {
  return invoke<Project[]>('projects')
}

export function startTimer(title: string | null, project: string | null): Promise<Snapshot> {
  return invoke<Snapshot>('start_timer', { title, project })
}

export function stopTimer(id: number): Promise<Snapshot> {
  return invoke<Snapshot>('stop_timer', { id })
}

export function discardTimer(id: number): Promise<Snapshot> {
  return invoke<Snapshot>('discard_timer', { id })
}

export function amendTimer(
  id: number,
  title: string | null,
  project: string | null,
): Promise<Snapshot> {
  return invoke<Snapshot>('amend_timer', { id, title, project })
}

export interface Group {
  summary: string
  projectId: number | null
  projectName: string | null
  totalSeconds: number
  totalHuman: string
  estimateSeconds: number
  estimateHuman: string
  entryIds: number[]
  days: string[]
  partIndex: number
  partCount: number
  jiraProjectKey: string | null
}

export interface Overlap {
  localDay: string
  trackedSeconds: number
  clockSeconds: number
  overlapSeconds: number
}

export interface Excluded {
  id: number
  description: string
  projectName: string | null
  durationHuman: string
  reason: string
}

export interface SummaryView {
  totalSeconds: number
  totalHuman: string
  estimateSeconds: number
  groups: Group[]
  overlaps: Overlap[]
  excluded: Excluded[]
}

export interface Scope {
  prefix: string
  projectId: number
  projectName: string
  slugSource: string
}

export function worked(range: 'today' | 'week'): Promise<SummaryView> {
  return invoke<SummaryView>('worked', { range })
}

export function pending(): Promise<SummaryView> {
  return invoke<SummaryView>('pending')
}

export function scopes(): Promise<Scope[]> {
  return invoke<Scope[]>('scopes')
}

export function addProject(name: string): Promise<Project[]> {
  return invoke<Project[]>('add_project', { name })
}

export function setScope(prefix: string, project: string): Promise<Scope[]> {
  return invoke<Scope[]>('set_scope', { prefix, project })
}

export function unsetScope(prefix: string): Promise<Scope[]> {
  return invoke<Scope[]>('unset_scope', { prefix })
}

export interface Check {
  id: string
  health: 'ok' | 'warn' | 'fail'
  title: string
  detail: string
  note: string | null
}

export interface Report {
  checks: Check[]
  canInstall: boolean
  blocked: boolean
}

export function doctorReport(): Promise<Report> {
  return invoke<Report>('doctor_report')
}

export function installCli(): Promise<string> {
  return invoke<string>('install_cli')
}

export function onSnapshot(handler: (value: Snapshot) => void): void {
  void listen<Snapshot>(SNAPSHOT_EVENT, (event) => {
    handler(event.payload)
  })
}

export function describeProblem(error: unknown): Problem {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  ) {
    const problem = error as Partial<Problem> & { message: string }
    return {
      kind: problem.kind ?? 'cli-failed',
      message: problem.message,
      hint: problem.hint ?? null,
    }
  }
  return { kind: 'cli-failed', message: String(error), hint: null }
}
