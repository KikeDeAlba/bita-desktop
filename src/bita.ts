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

export function snapshot(): Promise<Snapshot> {
  return invoke<Snapshot>('snapshot')
}

export function refresh(): Promise<Snapshot> {
  return invoke<Snapshot>('refresh')
}

export function onSnapshot(handler: (value: Snapshot) => void): void {
  void listen<Snapshot>(SNAPSHOT_EVENT, (event) => {
    handler(event.payload)
  })
}
