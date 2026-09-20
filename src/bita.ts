import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export const SNAPSHOT_EVENT = 'bita://snapshot'
export const DOCS_CHANGED_EVENT = 'bita://docs-changed'
export const NOTES_FOCUS_EVENT = 'bita://notes-focus'

export type ProblemKind =
  | 'node-missing'
  | 'cli-missing'
  | 'cli-too-old'
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
  docRelPath: string | null
  sectionsWritten: number | null
  sectionsTotal: number | null
  touchedSinceNote: number | null
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

export function openNotes(entryId: number | null): Promise<void> {
  return invoke<void>('open_notes', { entryId })
}

export function notesTakeFocus(): Promise<number | null> {
  return invoke<number | null>('notes_take_focus')
}

export type SectionState = 'written' | 'empty' | 'absent'

export interface DocSection {
  heading: string
  state: SectionState
  canonical: boolean
}

export type DocFileStatus = 'ok' | 'changed' | 'missing' | 'unverified'

export interface DocFile {
  status: DocFileStatus
  path: string
  checksum: string | null
  recordedChecksum: string
  byteSize: number | null
  recordedByteSize: number
  mtime: string | null
}

export interface DocSummary {
  relPath: string
  path: string
  docTitle: string
  kind: string
  source: string
  sectionCount: number
  byteSize: number
  createdAt: string
  recordedAt: string
  repoSlug: string | null
  branch: string | null
  headSha: string | null
  appendixCount: number
  sections: DocSection[] | null
  file: DocFile
}

export interface NoteRow {
  entryId: number
  projectId: number | null
  projectName: string | null
  projectSlug: string
  title: string
  localDay: string
  month: string
  startLocal: string
  durationSeconds: number
  durationHuman: string
  running: boolean
  registered: boolean
  issueKey: string | null
  doc: DocSummary | null
}

export interface DocDetail extends DocSummary {
  frontMatter: Record<string, string>
  frontMatterValid: boolean
  preamble: string
  markdown: string | null
}

export interface NoteAppendix {
  relPath: string
  path: string
  title: string
  sectionCount: number
  byteSize: number
}

export interface NoteDocument extends Omit<NoteRow, 'doc'> {
  doc: DocDetail | null
  appendices: NoteAppendix[]
}

export interface TreeMonth {
  month: string
  entryCount: number
  docCount: number
}

export interface TreeProject {
  projectId: number | null
  projectName: string | null
  projectSlug: string
  active: boolean
  entryCount: number
  docCount: number
  appendixCount: number
  firstDay: string | null
  lastDay: string | null
  lastDocAt: string | null
  months: TreeMonth[]
}

export interface Coverage {
  projectCount: number
  entryCount: number
  entriesWithDoc: number
  docCount: number
  appendixCount: number
  firstEntryDay: string | null
  lastEntryDay: string | null
}

export interface TreeMeta {
  root: string
  timezone: string
  sections: string[]
  totals: Coverage
}

export interface SearchMatch {
  offset: number
  length: number
  line: number
  section: string | null
  prefix: string
  match: string
  suffix: string
  snippet: string
}

export interface SearchHit {
  entryId: number
  projectId: number | null
  projectName: string | null
  projectSlug: string
  title: string
  docTitle: string
  localDay: string
  month: string
  relPath: string
  path: string
  matchCount: number
  matches: SearchMatch[]
  byteSize: number
  recordedAt: string
  file: DocFile
}

export interface SearchMeta {
  query: string
  documentsWithMatches: number
  totalMatches: number
  scanned: { documents: number; bytes: number; missing: number; elapsedMs: number }
  truncated: boolean
}

export interface ListMeta {
  root: string
  timezone: string
  page: { limit: number; offset: number; returned: number; total: number; hasMore: boolean }
  counts: { withDoc: number; withoutDoc: number }
  files: { verified: number; ok: number; changed: number; missing: number; unverified: number }
  warnings: string[]
}

export interface CliPayload<D, M> {
  data: D
  meta: M
}

export function notesTree(): Promise<CliPayload<{ projects: TreeProject[] }, TreeMeta>> {
  return invoke('notes_tree')
}

export function notesList(
  project: string | null,
  limit = 200,
  offset = 0,
): Promise<CliPayload<NoteRow[], ListMeta>> {
  return invoke('notes_list', { project, limit, offset })
}

export function notesToday(): Promise<CliPayload<NoteRow[], ListMeta>> {
  return invoke('notes_today')
}

export function notesDocument(entryId: number): Promise<CliPayload<NoteDocument, TreeMeta>> {
  return invoke('notes_document', { entryId })
}

export function notesSearch(
  query: string,
  project: string | null,
): Promise<CliPayload<SearchHit[], SearchMeta>> {
  return invoke('notes_search', { query, project })
}

export function notesMigrate(): Promise<CliPayload<unknown, unknown>> {
  return invoke('notes_migrate')
}

export function openDocument(relPath: string): Promise<void> {
  return invoke<void>('open_document', { relPath })
}

export function openExternal(url: string): Promise<void> {
  return invoke<void>('open_external', { url })
}

export function copyText(text: string): Promise<void> {
  return invoke<void>('copy_text', { text })
}

export function onDocsChanged(handler: () => void): void {
  void listen(DOCS_CHANGED_EVENT, () => {
    handler()
  })
}

export function onNotesFocus(handler: (entryId: number) => void): void {
  void listen<number>(NOTES_FOCUS_EVENT, (event) => {
    handler(event.payload)
  })
}

export function quit(): Promise<void> {
  return invoke<void>('quit')
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
