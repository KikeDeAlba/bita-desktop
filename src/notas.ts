import {
  backlogAdd,
  backlogList,
  backlogSetKind,
  backlogSetStatus,
  type BacklogItem,
  type BacklogKind,
  type BacklogStatus,
  copyText,
  describeProblem,
  meetingForEntry,
  openMeetingFolder,
  notesDocument,
  notesSearchPages,
  notesTakeFocus,
  notesTree,
  onDocsChanged,
  onMeetingMediaChanged,
  onNotesFocus,
  onSyncFinished,
  openDocument,
  openExternal,
  pageDocument,
  projects,
  recapList,
  searchTranscripts,
  type MeetingRecord,
  type PageDocument,
  type PageNode,
  type Problem,
  type Space,
} from './bita.ts'
import { must } from './dom.ts'
import { renderAside, type AsideState } from './notes/aside.ts'
import { renderRail, pageKey, type RailState, type Selection } from './notes/rail.ts'
import { renderReader, type ReaderState } from './notes/reader.ts'
import { attachSash } from './notes/sash.ts'
import {
  currentFrameSrc,
  hasVideo,
  latestMeeting,
  releaseMedia,
  seekTo,
  stopPlayback,
  type MeetingContext,
  type MeetingLoad,
  type MeetingTab,
} from './notes/meeting.ts'
import { fromPageHit, withTranscripts, type PageResult, type SearchScope } from './notes/search.ts'
import { closeSwitcher, isSwitcherOpen, toggleSwitcher, withPages } from './notes/switcher.ts'
import { meetingCount, meetingsAside, renderMeetings, type MeetingsContext } from './notes/meetings.ts'
import { openExportDialog } from './notes/export.ts'
import { isCompressing, onMediaJobs, openCompressDialog, openStripDialog } from './notes/media-dialogs.ts'
import { renderStorage, storageTotal } from './notes/storage.ts'
import { renderSpaceSettings } from './notes/space-settings.ts'
import { renderAtlassian } from './notes/atlassian.ts'
import { initProse, stepProse } from './notes/prose.ts'
import {
  focusBacklogItem,
  openCount,
  renderBacklog,
  type BacklogContext,
  type BacklogDraft,
  type BacklogPage,
} from './notes/backlog.ts'

const railHost = must<HTMLElement>('#rail')
const readerHost = must<HTMLElement>('#reader')
const asideHost = must<HTMLElement>('#aside')

const RAIL_KEY = 'bita.notes.rail'
const ASIDE_KEY = 'bita.notes.aside'
const SCALE_KEY = 'bita.notes.scale'
const SPACE_KEY = 'bita.notes.space'
const SCOPE_KEY = 'bita.notes.search-scope'
const SCALE_MIN = 0.8
const SCALE_MAX = 2
const SCALE_STEP = 0.1

let spaces: Space[] = []
let pageCount = 0
let expanded = new Set<string>()
let selected: Selection = null
let opened: PageDocument | null = null
let query = ''
let scope: SearchScope = rememberedScope()
let results: PageResult[] | null = null
let hit = 0
let hitCount = 0
let hitLabels: string[] = []
let active: string | null = null
let failure: Problem | null = null
let loadingTree = true
let loadingDoc = false
let railOpen = remembered(RAIL_KEY)
let asideOpen = remembered(ASIDE_KEY)
let logOpen = true
let scale = rememberedScale()
let backlog: BacklogItem[] | null = null
let backlogCopied: string | null = null
let backlogFailure: Problem | null = null
const backlogBusy = new Set<number>()
let copiedTimer = 0
let meetingTab: MeetingTab = 'document'
let meetingLoad: MeetingLoad | null = null
let meetingPageId: number | null = null
let meetingToken = 0

let activeSpace: string | null = rememberedText(SPACE_KEY)
let clients = new Map<number, string>()
let jiraKeys = new Map<number, string>()
let records: MeetingRecord[] | null = null
let storageBytes: number | null = null

let railPainted = ''
let readerPainted = ''
let asidePainted = ''
let searchToken = 0
let spy: IntersectionObserver | null = null

function remembered(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== 'closed'
  } catch {
    return true
  }
}

function rememberedText(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function rememberText(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    return
  }
}

function rememberedScope(): SearchScope {
  return rememberedText(SCOPE_KEY) === 'all' ? 'all' : 'space'
}

function rememberedScale(): number {
  try {
    const stored = Number(window.localStorage.getItem(SCALE_KEY))
    if (!Number.isFinite(stored) || stored <= 0) return 1
    return Math.min(SCALE_MAX, Math.max(SCALE_MIN, stored))
  } catch {
    return 1
  }
}

function applyScale(next: number): void {
  scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(next * 100) / 100))
  must<HTMLElement>('#notas').style.setProperty('--doc-scale', String(scale))
  try {
    window.localStorage.setItem(SCALE_KEY, String(scale))
  } catch {
    return
  }
}

function remember(key: string, open: boolean): void {
  try {
    window.localStorage.setItem(key, open ? 'open' : 'closed')
  } catch {
    return
  }
}

function railState(): RailState {
  const space = currentSpace()
  return {
    spaces,
    active: space,
    client: space?.projectId == null ? null : (clients.get(space.projectId) ?? null),
    expanded,
    selected,
    query,
    scope,
    results,
    loading: loadingTree,
    open: railOpen,
    backlogOpen: backlog === null ? null : openCount(backlog, backlogScope()),
    meetingCount: meetingCount(space),
    storageBytes,
  }
}

function backlogScope(): number | null | undefined {
  const space = currentSpace()
  return space === null ? undefined : space.projectId
}

function backlogPages(): BacklogPage[] {
  const pages: BacklogPage[] = []
  const walk = (list: PageNode[], prefix: string): void => {
    for (const page of list) {
      pages.push({ pageId: page.pageId, title: `${prefix}${page.title}` })
      walk(page.children ?? [], `${prefix}${page.title} / `)
    }
  }
  walk(currentSpace()?.pages ?? [], '')
  return pages
}

function backlogState(): BacklogContext {
  const space = currentSpace()
  return {
    items: backlog,
    failure: backlogFailure,
    busy: backlogBusy,
    projectId: backlogScope(),
    spaceName: space === null ? null : (space.projectName ?? 'Sin proyecto'),
    pages: backlogPages(),
    meetingEntryIds: meetingEntryIds(),
    copied: backlogCopied,
    railOpen,
    now: new Date(),
  }
}

function backlogSignature(): string {
  return [
    'backlog',
    currentSpace()?.projectSlug ?? '',
    spaces.map((space) => `${space.projectSlug}:${space.pageCount}`).join(','),
    backlogCopied ?? '',
    backlog === null
      ? 'pending'
      : backlog.map((item) => `${item.id}:${item.kind}:${item.status}:${item.updatedAt}:${item.key ?? ''}`).join(','),
    backlogFailure?.message ?? '',
    [...backlogBusy].join('.'),
    railOpen,
  ].join('~')
}

function readerState(): ReaderState {
  const order = flatOrder()
  const at = selected?.kind === 'page' ? order.indexOf(selected.id) : -1
  return {
    page: opened,
    query,
    hit,
    hitCount,
    failure,
    loading: loadingDoc,
    canPrev: at > 0,
    canNext: at !== -1 && at < order.length - 1,
    railOpen,
    asideOpen,
    meeting: meetingContext(),
    video: videoActions(),
  }
}

function readyView(): MeetingRecord | null {
  if (meetingLoad?.state !== 'ready') return null
  const view = meetingLoad.view
  return (records ?? []).find((record) => record.id === view.id) ?? null
}

function videoActions(): ReaderState['video'] {
  if (meetingLoad?.state !== 'ready' || !hasVideo(meetingLoad.view)) return null
  return { compressing: isCompressing(meetingLoad.view.id) }
}

function meetingContext(): MeetingContext | null {
  if (opened === null || meetingLoad === null) return null
  const info = latestMeeting(opened.meetings)
  if (info === null) return null
  return { info, tab: meetingTab, load: meetingLoad }
}

function meetingsContext(): MeetingsContext {
  return {
    space: currentSpace(),
    records,
    railOpen,
    onExpandRail: () => setRail(true),
    onOpenPage: (pageId) => {
      meetingTab = 'meeting'
      selectPage(pageId, true)
    },
    onStorage: selectStorage,
  }
}

function asideState(): AsideState {
  return {
    page: opened,
    active,
    open: asideOpen,
    logOpen,
    onToggleLog: toggleLog,
    meeting: meetingContext(),
    query: selected?.kind === 'page' ? query : '',
    hits: hitLabels,
    hit,
    atlassian: currentSpace()?.atlassian ?? null,
    custom: selected?.kind === 'meetings' ? meetingsAside(meetingsContext()) : null,
  }
}

function meetingSignature(): string {
  if (meetingLoad === null) return 'none'
  const view = meetingLoad.state === 'ready' ? `${meetingLoad.view.id}:${meetingLoad.view.recording ?? ''}` : ''
  const busy = meetingLoad.state === 'ready' ? isCompressing(meetingLoad.view.id) : false
  return `${meetingTab}:${meetingLoad.state}:${view}:${busy}`
}

function spacesSignature(): string {
  return spaces
    .map((space) => {
      const sync = space.atlassian?.sync
      return `${space.projectSlug}:${space.pageCount}:${sync?.pull ?? ''}:${sync?.push ?? ''}:${sync?.lastSyncAt ?? ''}`
    })
    .join(',')
}

function railSignature(): string {
  return [
    spacesSignature(),
    activeSpace ?? '',
    currentSpace()?.pages.length ?? 0,
    clients.size,
    pageCount,
    [...expanded].sort().join('|'),
    selected === null ? 'none' : `${selected.kind}:${selected.id}`,
    query,
    scope,
    results === null ? 'pending' : results.map((result) => `${result.pageId}:${result.matchCount}`).join('.'),
    loadingTree,
    railOpen,
    backlog === null ? 'pending' : openCount(backlog, backlogScope()),
    storageBytes ?? '',
  ].join('~')
}

function readerSignature(): string {
  return [
    selected === null ? 'none' : `${selected.kind}:${selected.id}`,
    opened?.doc.relPath ?? 'none',
    opened?.doc.file.status ?? 'none',
    opened?.recordedAt ?? '',
    query,
    hit,
    hitCount,
    failure?.message ?? '',
    loadingDoc,
    railOpen,
    asideOpen,
    meetingSignature(),
  ].join('~')
}

function asideSignature(): string {
  return [
    selected?.kind ?? 'none',
    opened?.pageId ?? 'none',
    opened?.recordedAt ?? '',
    opened?.entries.length ?? 0,
    opened?.issues.map((issue) => `${issue.issueKey}:${issue.statusCategory}`).join(',') ?? '',
    opened?.refs?.map((ref) => ref.url).join(',') ?? '',
    opened?.backlog?.map((item) => `${item.id}:${item.status}`).join(',') ?? '',
    active ?? '',
    asideOpen,
    logOpen,
    meetingLoad?.state ?? 'none',
    query,
    hit,
    hitLabels.join('|'),
    spacesSignature(),
    activeSpace ?? '',
    selected?.kind === 'meetings' ? (records === null ? 'pending' : records.map((record) => `${record.id}:${record.storage.totalBytes}`).join(',')) : '',
  ].join('~')
}

function viewSignature(kind: string): string {
  return [
    kind,
    spacesSignature(),
    activeSpace ?? '',
    railOpen,
    kind === 'meetings' ? (records === null ? 'pending' : records.map((record) => `${record.id}:${record.storage.totalBytes}:${record.hasVideo}`).join(',')) : '',
  ].join('~')
}

function paint(): void {
  const root = must<HTMLElement>('#notas')
  const kind = selected?.kind ?? null
  root.classList.toggle('notas--backlog', kind === 'backlog')
  root.classList.toggle('notas--wide', kind === 'storage' || kind === 'space-settings' || kind === 'atlassian')
  const rail = railSignature()
  if (rail !== railPainted) {
    railPainted = rail
    renderRail(railHost, railState(), {
      onQuery: runQuery,
      onScope: setScope,
      onToggle: toggleNode,
      onSelectPage: (pageId) => selectPage(pageId),
      onSelectResult: selectResult,
      onSelectBacklog: selectBacklog,
      onSelectMeetings: selectMeetings,
      onSelectStorage: selectStorage,
      onSelectSettings: selectSettings,
      onSwitcher: showSwitcher,
      onSpace: (slug) => {
        switchSpace(slug)
        setRail(true)
      },
      onCollapse: () => setRail(false),
      onExpand: () => setRail(true),
    })
  }

  if (kind === 'backlog') {
    const view = backlogSignature()
    if (view !== readerPainted) {
      readerPainted = view
      renderBacklog(readerHost, backlogState(), {
        onResolve: (id, resolution) => {
          setBacklogStatus(id, 'resolved', resolution)
        },
        onReopen: (id) => {
          setBacklogStatus(id, 'open', null)
        },
        onConvert: setBacklogKind,
        onCreate: createBacklogItem,
        onOpenPage: selectPage,
        onCopy: copyBacklogText,
        onExpandRail: () => setRail(true),
      })
    }
  } else if (kind === 'meetings' || kind === 'storage' || kind === 'space-settings' || kind === 'atlassian') {
    const view = viewSignature(kind)
    if (view !== readerPainted) {
      readerPainted = view
      paintView(kind)
    }
  } else {
    const reader = readerSignature()
    if (reader !== readerPainted) {
      readerPainted = reader
      renderReader(readerHost, readerState(), {
        onPrev: () => step(-1),
        onNext: () => step(1),
        onCopy: copy,
        onOpenDocument: (relPath) => {
          void openDocument(relPath).catch(showFailure)
        },
        onOpenExternal: (url) => {
          void openExternal(url).catch(showFailure)
        },
        onHit: moveHit,
        onCrumb: selectPage,
        onExpandRail: () => setRail(true),
        onExpandAside: () => setAside(true),
        onMeetingTab: setMeetingTab,
        onSeek: seekMeeting,
        onExport: exportCurrent,
        onCompress: compressCurrent,
        onStripVideo: stripCurrent,
      })
      afterReaderPaint()
    }
  }

  const aside = asideSignature()
  if (aside !== asidePainted) {
    asidePainted = aside
    renderAside(asideHost, asideState(), {
      onHeading: scrollToHeading,
      onIssue: (url) => {
        void openExternal(url).catch(showFailure)
      },
      onChild: selectPage,
      onEntry: openEntryDocument,
      onBacklog: selectBacklog,
      onBacklogItem: openBacklogItem,
      onCollapse: () => setAside(false),
      onExpand: () => setAside(true),
      onOpenFolder: (dir) => {
        void openMeetingFolder(dir).catch(showFailure)
      },
      onHit: (index) => {
        moveHit(index - hit)
      },
    })
  }
}

function paintView(kind: 'meetings' | 'storage' | 'space-settings' | 'atlassian'): void {
  const space = currentSpace()
  if (kind === 'meetings') {
    renderMeetings(readerHost, meetingsContext())
    return
  }
  if (kind === 'storage') {
    renderStorage(readerHost, {
      spaces,
      activeSpace: space,
      railOpen,
      onExpandRail: () => setRail(true),
      onOpenPage: (pageId) => selectPage(pageId, true),
      beforeReplace: releaseIfShowing,
    })
    return
  }
  if (kind === 'atlassian') {
    renderAtlassian(readerHost, {
      railOpen,
      onExpandRail: () => setRail(true),
      onBack: selectSettings,
    })
    return
  }
  if (space === null) {
    readerHost.replaceChildren()
    return
  }
  renderSpaceSettings(readerHost, {
    space,
    clientName: space.projectId === null ? null : (clients.get(space.projectId) ?? null),
    jiraKey: space.projectId === null ? null : (jiraKeys.get(space.projectId) ?? null),
    railOpen,
    onExpandRail: () => setRail(true),
    onManageConnections: selectAtlassian,
    onSaved: () => {
      void loadTree()
    },
  })
}

function releaseIfShowing(meetingId: string): void {
  if (meetingLoad?.state === 'ready' && meetingLoad.view.id === meetingId) releaseMedia()
}

function setMeetingTab(tab: MeetingTab): void {
  if (tab === meetingTab) return
  meetingTab = tab
  if (tab === 'document') stopPlayback()
  paint()
}

function seekMeeting(seconds: number): void {
  const context = meetingContext()
  if (context === null || context.load.state !== 'ready') return
  const view = context.load.view
  if (meetingTab !== 'meeting') {
    meetingTab = 'meeting'
    paint()
  }
  seekTo(view, seconds)
}

async function loadMeeting(pageId: number, entryId: number): Promise<void> {
  const token = meetingToken + 1
  meetingToken = token
  if (meetingPageId !== pageId || meetingLoad === null) meetingLoad = { state: 'loading' }
  paint()
  try {
    const view = await meetingForEntry(entryId)
    if (token !== meetingToken) return
    meetingLoad = view === null ? { state: 'missing' } : { state: 'ready', view }
  } catch (error) {
    if (token !== meetingToken) return
    meetingLoad = { state: 'failed', problem: describeProblem(error) }
  }
  paint()
}

function setRail(open: boolean): void {
  railOpen = open
  remember(RAIL_KEY, open)
  paint()
}

function setAside(open: boolean): void {
  asideOpen = open
  remember(ASIDE_KEY, open)
  paint()
}

function toggleLog(): void {
  logOpen = !logOpen
  paint()
}

function afterReaderPaint(): void {
  const marks = [...readerHost.querySelectorAll<HTMLElement>('mark.hit')]
  const labels = marks.map(hitLabel)
  if (marks.length !== hitCount || labels.join('|') !== hitLabels.join('|')) {
    if (marks.length !== hitCount) hit = 0
    hitCount = marks.length
    hitLabels = labels
    readerPainted = readerSignature()
  }
  highlightHit(marks)
  watchSections()
}

function hitLabel(mark: HTMLElement): string {
  const tagged = mark.closest<HTMLElement>('[data-hit-label]')
  if (tagged !== null) return tagged.dataset['hitLabel'] ?? ''
  const section = mark.closest<HTMLElement>('.doc-section[data-heading]')
  if (section !== null) return section.dataset['heading'] ?? ''
  if (mark.closest('.room-row') !== null) return 'Transcripción'
  if (mark.closest('.meeting-article') !== null) return 'Minuta'
  return 'Introducción'
}

function highlightHit(marks: HTMLElement[]): void {
  marks.forEach((mark, index) => {
    mark.classList.toggle('hit--on', index === hit)
  })
  const current = marks[hit]
  if (current) current.scrollIntoView({ block: 'center' })
}

function moveHit(delta: number): void {
  if (hitCount === 0) return
  hit = (hit + delta + hitCount) % hitCount
  highlightHit([...readerHost.querySelectorAll<HTMLElement>('mark.hit')])
  const label = readerHost.querySelector<HTMLElement>('.hit-count')
  if (label) label.textContent = `«${query.trim()}» ${hit + 1} de ${hitCount}`
  readerPainted = readerSignature()
  paint()
}

function scrollToHeading(anchor: string): void {
  const target = readerHost.querySelector<HTMLElement>(`#${CSS.escape(anchor)}`)
  target?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}

function watchSections(): void {
  spy?.disconnect()
  const blocks = [...readerHost.querySelectorAll<HTMLElement>('.doc-section[data-heading]')]
  if (blocks.length === 0) {
    active = null
    return
  }

  spy = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)[0]
      if (!visible) return
      const anchor = (visible.target as HTMLElement).id
      if (anchor === active) return
      active = anchor
      paint()
    },
    { root: readerHost.querySelector('.doc-body'), rootMargin: '-10% 0px -70% 0px' },
  )
  for (const block of blocks) spy.observe(block)
}

function allPages(): PageNode[] {
  const flat: PageNode[] = []
  const walk = (list: PageNode[]): void => {
    for (const page of list) {
      flat.push(page)
      walk(page.children ?? [])
    }
  }
  for (const space of spaces) walk(space.pages)
  return flat
}

function spacePages(space: Space | null): PageNode[] {
  const flat: PageNode[] = []
  const walk = (list: PageNode[]): void => {
    for (const page of list) {
      flat.push(page)
      walk(page.children ?? [])
    }
  }
  walk(space?.pages ?? [])
  return flat
}

export function currentSpace(): Space | null {
  return spaces.find((space) => space.projectSlug === activeSpace) ?? null
}

export function meetingEntryIds(): Set<number> {
  const ids = new Set<number>()
  for (const page of allPages()) {
    for (const meeting of page.meetings ?? []) ids.add(meeting.entryId)
  }
  return ids
}

function spaceOfPage(pageId: number): Space | null {
  return spaces.find((space) => spacePages(space).some((page) => page.pageId === pageId)) ?? null
}

function crumbOf(page: PageNode): string {
  const byId = new Map(allPages().map((node) => [node.pageId, node]))
  const trail: string[] = []
  let cursor = page.parentId === null ? undefined : byId.get(page.parentId)
  while (cursor !== undefined) {
    trail.unshift(cursor.title)
    cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId)
  }
  return trail.length === 0 ? 'Raíz del espacio' : trail.join(' / ')
}

function flatOrder(): number[] {
  const order: number[] = []
  const walk = (list: PageNode[]): void => {
    for (const page of list) {
      order.push(page.pageId)
      if (expanded.has(pageKey(page))) walk(page.children ?? [])
    }
  }
  walk(currentSpace()?.pages ?? [])
  return order
}

function step(delta: number): void {
  const order = flatOrder()
  if (order.length === 0) return
  const at = selected?.kind === 'page' ? order.indexOf(selected.id) : -1
  const next = order[at === -1 ? 0 : Math.min(order.length - 1, Math.max(0, at + delta))]
  if (next !== undefined && next !== selected?.id) selectPage(next)
}

function leavePage(): void {
  stopPlayback()
  opened = null
  active = null
  failure = null
}

function selectMeetings(): void {
  selected = { kind: 'meetings', id: 0 }
  leavePage()
  paint()
  void loadRecords()
}

function selectStorage(): void {
  selected = { kind: 'storage', id: 0 }
  leavePage()
  paint()
}

function selectSettings(): void {
  selected = { kind: 'space-settings', id: 0 }
  leavePage()
  paint()
}

function selectAtlassian(): void {
  selected = { kind: 'atlassian', id: 0 }
  leavePage()
  paint()
}

async function loadRecords(): Promise<void> {
  try {
    records = await recapList()
  } catch {
    records = records ?? []
  }
  paint()
}

function refreshStorageTotal(): void {
  void storageTotal()
    .then((bytes) => {
      storageBytes = bytes
      paint()
    })
    .catch(() => undefined)
}

function switchSpace(slug: string, keepSelection = false): void {
  const space = spaces.find((candidate) => candidate.projectSlug === slug)
  if (space === undefined) return
  const changed = slug !== activeSpace
  activeSpace = slug
  rememberText(SPACE_KEY, slug)
  if (!changed || keepSelection) {
    paint()
    return
  }
  if (query.trim().length > 0 && scope === 'space') runQuery(query)
  if (selected?.kind === 'page' || selected === null) {
    selected = null
    leavePage()
  }
  readerPainted = ''
  paint()
}

function showSwitcher(anchor: HTMLElement): void {
  toggleSwitcher({ anchor, spaces, active: activeSpace, onPick: (slug) => switchSpace(slug) })
}

function setScope(next: SearchScope): void {
  if (next === scope) return
  scope = next
  rememberText(SCOPE_KEY, next)
  runQuery(query)
}

function selectBacklog(): void {
  selected = { kind: 'backlog', id: 0 }
  leavePage()
  paint()
  void loadBacklog()
}

async function loadBacklog(): Promise<void> {
  try {
    const payload = await backlogList()
    backlog = payload.data
    backlogFailure = null
  } catch (error) {
    backlogFailure = describeProblem(error)
  }
  paint()
}

function openBacklogItem(id: number): void {
  focusBacklogItem(id)
  readerPainted = ''
  selectBacklog()
}

async function createBacklogItem(draft: BacklogDraft): Promise<void> {
  const project = currentSpace()?.projectSlug ?? null
  await backlogAdd(draft.kind, draft.title, draft.body.length > 0 ? draft.body : null, draft.pageId, project)
  await loadBacklog()
}

function copyBacklogText(text: string): void {
  void copyText(text)
    .then(() => {
      backlogCopied = text
      window.clearTimeout(copiedTimer)
      copiedTimer = window.setTimeout(() => {
        backlogCopied = null
        paint()
      }, 1500)
      paint()
    })
    .catch((error: unknown) => {
      backlogFailure = describeProblem(error)
      paint()
    })
}

function afterBacklogChange(id: number, run: () => Promise<{ data: BacklogItem }>): void {
  backlogBusy.add(id)
  paint()
  void (async () => {
    try {
      const payload = await run()
      backlog = (backlog ?? []).map((item) => (item.id === id ? { ...item, ...payload.data } : item))
      backlogFailure = null
    } catch (error) {
      backlogFailure = describeProblem(error)
    }
    backlogBusy.delete(id)
    paint()
  })()
}

function setBacklogStatus(id: number, status: BacklogStatus, resolution: string | null): void {
  afterBacklogChange(id, () => backlogSetStatus(id, status, resolution))
}

function setBacklogKind(id: number, kind: BacklogKind): void {
  afterBacklogChange(id, () => backlogSetKind(id, kind))
}

function selectPage(pageId: number, keepTab = false): void {
  const owner = spaceOfPage(pageId)
  if (owner !== null && owner.projectSlug !== activeSpace) switchSpace(owner.projectSlug, true)
  if (!keepTab && meetingPageId !== pageId) meetingTab = 'document'
  selected = { kind: 'page', id: pageId }
  hit = 0
  active = null
  revealAncestors(pageId)
  paint()
  void loadPage(pageId, keepTab)
}

function selectResult(result: PageResult): void {
  selectPage(result.pageId, result.page === 0 && result.entries === 0 && result.transcript > 0)
  if (result.page === 0 && result.entries === 0 && result.transcript > 0) meetingTab = 'meeting'
}

function revealAncestors(pageId: number): void {
  const byId = new Map(allPages().map((page) => [page.pageId, page]))
  let cursor = byId.get(pageId)
  while (cursor?.parentId != null) {
    const parent = byId.get(cursor.parentId)
    if (!parent) break
    expanded.add(pageKey(parent))
    cursor = parent
  }
}

async function loadPage(pageId: number, keepTab = false): Promise<void> {
  loadingDoc = true
  failure = null
  paint()

  try {
    const payload = await pageDocument(pageId)
    if (selected?.kind !== 'page' || selected.id !== pageId) return
    opened = payload.data
    loadingDoc = false
    const info = latestMeeting(opened.meetings)
    if (meetingPageId !== pageId) {
      if (!keepTab) meetingTab = 'document'
      stopPlayback()
    }
    if (info === null) {
      meetingLoad = null
      meetingTab = 'document'
      meetingPageId = pageId
    } else if (meetingPageId !== pageId || meetingLoad?.state !== 'ready') {
      void loadMeeting(pageId, info.entryId)
      meetingPageId = pageId
    }
  } catch (error) {
    if (selected?.kind !== 'page' || selected.id !== pageId) return
    loadingDoc = false
    failure = describeProblem(error)
  }
  paint()
}

function reloadMeeting(): void {
  if (opened === null) return
  const info = latestMeeting(opened.meetings)
  if (info === null) return
  meetingPageId = opened.pageId
  void loadMeeting(opened.pageId, info.entryId)
}

function currentRecord(): Promise<MeetingRecord | null> {
  const known = readyView()
  if (known !== null) return Promise.resolve(known)
  return recapList()
    .then((list) => {
      records = list
      return readyView()
    })
    .catch((error: unknown) => {
      showFailure(error)
      return null
    })
}

function compressCurrent(): void {
  if (meetingLoad?.state !== 'ready') return
  const view = meetingLoad.view
  void currentRecord().then((record) => {
    if (record === null) return
    openCompressDialog(record, { frameSrc: currentFrameSrc(view), beforeReplace: releaseMedia })
  })
}

function stripCurrent(): void {
  if (meetingLoad?.state !== 'ready') return
  void currentRecord().then((record) => {
    if (record === null) return
    openStripDialog(record, {
      beforeReplace: releaseMedia,
      onDone: () => {
        void loadRecords()
        reloadMeeting()
        refreshStorageTotal()
      },
    })
  })
}

function exportCurrent(): void {
  if (opened === null) return
  const node = allPages().find((page) => page.pageId === opened?.pageId)
  const space = spaceOfPage(opened.pageId) ?? currentSpace()
  if (node === undefined || space === null) return
  openExportDialog({
    root: node,
    space,
    client: space.projectId === null ? null : (clients.get(space.projectId) ?? null),
    onOpenDocument: (relPath) => {
      void openDocument(relPath).catch(showFailure)
    },
  })
}

function openEntryDocument(entryId: number): void {
  void (async () => {
    try {
      const payload = await notesDocument(entryId)
      const relPath = payload.data.doc?.relPath
      if (relPath === undefined) {
        failure = {
          kind: 'unreadable',
          message: 'Ese bloque no dejó un documento propio.',
          hint: 'Lo que se hizo está en el registro de la página.',
        }
        paint()
        return
      }
      await openDocument(relPath)
    } catch (error) {
      showFailure(error)
    }
  })()
}

function toggleNode(key: string): void {
  if (expanded.has(key)) expanded.delete(key)
  else expanded.add(key)
  paint()
}

function runQuery(value: string): void {
  query = value
  const token = searchToken + 1
  searchToken = token

  if (value.trim().length === 0) {
    results = null
    hitLabels = []
    paint()
    return
  }

  results = null
  paint()

  window.setTimeout(() => {
    if (searchToken !== token) return
    void search(value.trim(), token)
  }, 180)
}

async function search(value: string, token: number): Promise<void> {
  const space = scope === 'space' ? currentSpace() : null
  try {
    const payload = await notesSearchPages(value, space?.projectSlug ?? null)
    if (searchToken !== token) return
    const pages = space === null ? allPages() : spacePages(space)
    const allowed = new Set(pages.map((page) => page.pageId))
    results = payload.data.map(fromPageHit).filter((result) => space === null || allowed.has(result.pageId))
    paint()
    const entryIds = pages.flatMap((page) => (page.meetings ?? []).map((meeting) => meeting.entryId))
    if (entryIds.length === 0) return
    const transcripts = await searchTranscripts(value, entryIds).catch(() => [])
    if (searchToken !== token || results === null) return
    results = withTranscripts(results, transcripts, pages, crumbOf)
  } catch (error) {
    if (searchToken !== token) return
    results = []
    failure = describeProblem(error)
  }
  paint()
}

function copy(text: string): void {
  void copyText(text).catch(showFailure)
}

function showFailure(error: unknown): void {
  failure = describeProblem(error)
  paint()
}

function chooseDefaultSpace(): void {
  if (spaces.some((space) => space.projectSlug === activeSpace)) return
  const first = withPages(spaces)[0] ?? spaces[0]
  activeSpace = first?.projectSlug ?? null
}

async function loadTree(): Promise<void> {
  loadingTree = true
  try {
    const payload = await notesTree()
    spaces = payload.data.spaces ?? []
    pageCount = spaces.reduce((total, space) => total + space.pageCount, 0)
    chooseDefaultSpace()
    failure = null
  } catch (error) {
    failure = describeProblem(error)
  }
  loadingTree = false
  paint()
}

async function loadClients(): Promise<void> {
  try {
    const list = await projects()
    clients = new Map(list.filter((project) => project.clientName !== null).map((project) => [project.id, project.clientName as string]))
    jiraKeys = new Map(
      list.filter((project) => project.jiraProjectKey !== null).map((project) => [project.id, project.jiraProjectKey as string]),
    )
    paint()
  } catch {
    return
  }
}

function focusOnPage(pageId: number): void {
  if (allPages().some((page) => page.pageId === pageId)) selectPage(pageId)
}

function keys(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null
  const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'
  const command = event.metaKey || event.ctrlKey

  if (command && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    if (!railOpen) setRail(true)
    const anchor = railHost.querySelector<HTMLElement>('#space-switch')
    if (anchor !== null) showSwitcher(anchor)
    return
  }

  if (command && /^[1-9]$/.test(event.key)) {
    const space = withPages(spaces)[Number(event.key) - 1]
    if (space !== undefined) {
      event.preventDefault()
      closeSwitcher()
      switchSpace(space.projectSlug)
    }
    return
  }

  if (isSwitcherOpen()) return

  if (command && event.key.toLowerCase() === 'f') {
    event.preventDefault()
    if (!railOpen) setRail(true)
    const input = railHost.querySelector<HTMLInputElement>('#rail-query')
    input?.focus()
    input?.select()
    return
  }

  if (command && (event.key === '=' || event.key === '+')) {
    event.preventDefault()
    applyScale(scale + SCALE_STEP)
    return
  }

  if (command && (event.key === '-' || event.key === '_')) {
    event.preventDefault()
    applyScale(scale - SCALE_STEP)
    return
  }

  if (command && event.key === '0') {
    event.preventDefault()
    applyScale(1)
    return
  }

  if (command && (event.key === ']' || event.key === '[')) {
    event.preventDefault()
    stepProse(event.key === ']' ? 1 : -1)
    return
  }

  if (command && event.key.toLowerCase() === 'g') {
    event.preventDefault()
    moveHit(event.shiftKey ? -1 : 1)
    return
  }

  if (event.key === 'Escape') {
    if (document.querySelector('.export-overlay, .mdlg-overlay') !== null) return
    if (query.trim().length > 0) {
      runQuery('')
      return
    }
    if (typing) (target as HTMLInputElement).blur()
    return
  }

  if (typing) return
  if (selected?.kind !== 'page') return
  if (target?.closest('.room-list, .mp-track') != null) return

  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault()
    step(-1)
    return
  }

  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault()
    step(1)
  }
}

function attachSashes(): void {
  const root = must<HTMLElement>('#notas')
  attachSash({
    handle: must<HTMLElement>('#sash-rail'),
    root,
    variable: '--rail-open',
    side: 'left',
    storageKey: 'bita.notes.rail-width',
    initial: 240,
    min: 180,
    max: 520,
    readerMin: 420,
    otherWidth: () => asideHost.getBoundingClientRect().width,
  })
  attachSash({
    handle: must<HTMLElement>('#sash-aside'),
    root,
    variable: '--aside-open',
    side: 'right',
    storageKey: 'bita.notes.aside-width',
    initial: 200,
    min: 160,
    max: 440,
    readerMin: 420,
    otherWidth: () => railHost.getBoundingClientRect().width,
  })
}

async function start(): Promise<void> {
  applyScale(scale)
  initProse(must<HTMLElement>('#notas'))
  attachSashes()
  window.addEventListener('keydown', keys)
  onDocsChanged(() => {
    void loadTree()
    void loadBacklog()
    if (selected?.kind === 'page') void loadPage(selected.id, true)
    if (selected?.kind === 'meetings') void loadRecords()
  })
  onSyncFinished(() => {
    void loadTree()
  })
  onNotesFocus((pageId) => {
    focusOnPage(pageId)
  })
  onMeetingMediaChanged((change) => {
    void loadRecords()
    refreshStorageTotal()
    if (change.ok && meetingLoad?.state === 'ready' && meetingLoad.view.id === change.id) reloadMeeting()
    else paint()
  })
  onMediaJobs(() => {
    readerPainted = ''
    paint()
  })

  paint()
  await loadTree()
  void loadBacklog()
  void loadClients()
  refreshStorageTotal()

  const focus = await notesTakeFocus()
  if (focus !== null) focusOnPage(focus)
}

void start()
