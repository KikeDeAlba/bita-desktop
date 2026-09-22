import {
  copyText,
  describeProblem,
  notesDocument,
  notesSearch,
  notesTakeFocus,
  notesTree,
  onDocsChanged,
  onNotesFocus,
  openDocument,
  openExternal,
  pageDocument,
  type PageDocument,
  type PageNode,
  type Problem,
  type SearchHit,
  type Space,
} from './bita.ts'
import { must } from './dom.ts'
import { renderAside, type AsideState } from './notes/aside.ts'
import { renderRail, pageKey, spaceKey, type RailState, type Selection } from './notes/rail.ts'
import { renderReader, type ReaderState } from './notes/reader.ts'

const railHost = must<HTMLElement>('#rail')
const readerHost = must<HTMLElement>('#reader')
const asideHost = must<HTMLElement>('#aside')

const RAIL_KEY = 'bita.notes.rail'
const ASIDE_KEY = 'bita.notes.aside'

let spaces: Space[] = []
let pageCount = 0
let expanded = new Set<string>()
let selected: Selection = null
let opened: PageDocument | null = null
let query = ''
let results: SearchHit[] | null = null
let hit = 0
let hitCount = 0
let active: string | null = null
let failure: Problem | null = null
let loadingTree = true
let loadingDoc = false
let railOpen = remembered(RAIL_KEY)
let asideOpen = remembered(ASIDE_KEY)
let logOpen = true

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

function remember(key: string, open: boolean): void {
  try {
    window.localStorage.setItem(key, open ? 'open' : 'closed')
  } catch {
    return
  }
}

function railState(): RailState {
  return {
    spaces,
    expanded,
    selected,
    query,
    results,
    pageCount,
    loading: loadingTree,
    open: railOpen,
  }
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
  }
}

function asideState(): AsideState {
  return { page: opened, active, open: asideOpen, logOpen, onToggleLog: toggleLog }
}

function railSignature(): string {
  return [
    spaces.map((space) => `${space.projectSlug}:${space.pageCount}`).join(','),
    pageCount,
    [...expanded].sort().join('|'),
    selected === null ? 'none' : `${selected.kind}:${selected.id}`,
    query,
    results === null ? 'pending' : results.map((entry) => entry.entryId).join('.'),
    loadingTree,
    railOpen,
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
  ].join('~')
}

function asideSignature(): string {
  return [
    opened?.pageId ?? 'none',
    opened?.recordedAt ?? '',
    opened?.entries.length ?? 0,
    opened?.issues.map((issue) => `${issue.issueKey}:${issue.statusCategory}`).join(',') ?? '',
    active ?? '',
    asideOpen,
    logOpen,
  ].join('~')
}

function paint(): void {
  const rail = railSignature()
  if (rail !== railPainted) {
    railPainted = rail
    renderRail(railHost, railState(), {
      onQuery: runQuery,
      onToggle: toggleNode,
      onSelectPage: selectPage,
      onSelectEntry: openEntryDocument,
      onCollapse: () => setRail(false),
    })
  }

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
    })
    afterReaderPaint()
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
      onCollapse: () => setAside(false),
      onExpand: () => setAside(true),
    })
  }
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
  if (marks.length !== hitCount) {
    hitCount = marks.length
    hit = 0
    readerPainted = readerSignature()
  }
  highlightHit(marks)
  watchSections()
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
  if (label) label.textContent = `${hit + 1} / ${hitCount}`
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

function flatOrder(): number[] {
  const order: number[] = []
  const walk = (list: PageNode[]): void => {
    for (const page of list) {
      order.push(page.pageId)
      if (expanded.has(pageKey(page))) walk(page.children ?? [])
    }
  }
  for (const space of spaces) {
    if (!expanded.has(spaceKey(space))) continue
    walk(space.pages)
  }
  return order
}

function step(delta: number): void {
  const order = flatOrder()
  if (order.length === 0) return
  const at = selected?.kind === 'page' ? order.indexOf(selected.id) : -1
  const next = order[at === -1 ? 0 : Math.min(order.length - 1, Math.max(0, at + delta))]
  if (next !== undefined && next !== selected?.id) selectPage(next)
}

function selectPage(pageId: number): void {
  selected = { kind: 'page', id: pageId }
  hit = 0
  active = null
  revealAncestors(pageId)
  paint()
  void loadPage(pageId)
}

function revealAncestors(pageId: number): void {
  const byId = new Map(allPages().map((page) => [page.pageId, page]))
  let cursor = byId.get(pageId)
  const space = spaces.find((candidate) => candidate.projectId === cursor?.projectId)
  if (space) expanded.add(spaceKey(space))

  while (cursor?.parentId != null) {
    const parent = byId.get(cursor.parentId)
    if (!parent) break
    expanded.add(pageKey(parent))
    cursor = parent
  }
}

async function loadPage(pageId: number): Promise<void> {
  loadingDoc = true
  failure = null
  paint()

  try {
    const payload = await pageDocument(pageId)
    if (selected?.kind !== 'page' || selected.id !== pageId) return
    opened = payload.data
    loadingDoc = false
  } catch (error) {
    if (selected?.kind !== 'page' || selected.id !== pageId) return
    loadingDoc = false
    failure = describeProblem(error)
  }
  paint()
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
    paint()
    return
  }

  results = null
  paint()

  window.setTimeout(() => {
    if (searchToken !== token) return
    void search(value, token)
  }, 180)
}

async function search(value: string, token: number): Promise<void> {
  try {
    const payload = await notesSearch(value, null)
    if (searchToken !== token) return
    results = payload.data
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

async function loadTree(): Promise<void> {
  loadingTree = true
  try {
    const payload = await notesTree()
    spaces = payload.data.spaces ?? []
    pageCount = spaces.reduce((total, space) => total + space.pageCount, 0)
    if (expanded.size === 0) {
      const first = spaces.find((space) => space.pageCount > 0)
      if (first) expanded.add(spaceKey(first))
    }
    failure = null
  } catch (error) {
    failure = describeProblem(error)
  }
  loadingTree = false
  paint()
}

function focusOnPage(pageId: number): void {
  if (allPages().some((page) => page.pageId === pageId)) selectPage(pageId)
}

function keys(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null
  const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault()
    if (!railOpen) setRail(true)
    const input = railHost.querySelector<HTMLInputElement>('#rail-query')
    input?.focus()
    input?.select()
    return
  }

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'g') {
    event.preventDefault()
    moveHit(event.shiftKey ? -1 : 1)
    return
  }

  if (event.key === 'Escape') {
    if (query.trim().length > 0) {
      runQuery('')
      return
    }
    if (typing) (target as HTMLInputElement).blur()
    return
  }

  if (typing) return

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

async function start(): Promise<void> {
  window.addEventListener('keydown', keys)
  onDocsChanged(() => {
    void loadTree()
    if (selected?.kind === 'page') void loadPage(selected.id)
  })
  onNotesFocus((pageId) => {
    focusOnPage(pageId)
  })

  paint()
  await loadTree()

  const focus = await notesTakeFocus()
  if (focus !== null) focusOnPage(focus)
}

void start()
