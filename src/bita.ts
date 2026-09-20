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
