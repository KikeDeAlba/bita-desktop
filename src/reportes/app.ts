import type { PresetId, RangeChoice } from './model.ts'
import type { ExportFormat, ExportInclude, GroupBy, PaySettings, ReportView } from './types.ts'

export type Grouping = 'day' | 'week' | 'month'

export type View = { name: 'dashboard' } | { name: 'detail'; projectId: number | null } | { name: 'export' }

export interface Remote {
  report: ReportView | null
  error: unknown
  loading: boolean
  token: number
}

export interface DetailState extends Remote {
  key: string
  sort: 'date' | 'duration'
}

export type Destination = 'downloads' | 'clipboard' | 'inkwell'

export interface ExportState extends Remote {
  choice: RangeChoice
  format: ExportFormat
  groupBy: GroupBy
  include: ExportInclude
  destination: Destination
  only: Set<string> | null
  excluded: Set<string>
  expanded: boolean
  status: { text: string; error: boolean } | null
  busy: boolean
}

export interface PayDraft {
  salary: string
  currency: string
  hours: string
  multiplier: string
  excluded: Set<number>
}

export interface PayState {
  settings: PaySettings | null
  error: unknown
  open: boolean
  draft: PayDraft | null
  saving: boolean
  status: string | null
}

export interface App {
  view: View
  choice: RangeChoice
  shownPreset: PresetId
  main: Remote
  excluded: Set<string>
  grouping: Grouping
  railExpanded: boolean
  tableExpanded: boolean
  copied: boolean
  detail: DetailState | null
  exporting: ExportState | null
  pay: PayState
  today: string
  render(): void
  navigate(view: View): void
  selectPreset(preset: PresetId): void
  applyRange(choice: RangeChoice): void
  reload(): void
  openExport(scope: { projectId: number | null } | null): void
  openPay(): void
  closePay(): void
}
