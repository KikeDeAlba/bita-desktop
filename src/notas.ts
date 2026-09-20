import {
  copyText,
  describeProblem,
  notesDocument,
  notesList,
  notesSearch,
  notesTakeFocus,
  notesTree,
  onDocsChanged,
  onNotesFocus,
  openDocument,
  openExternal,
  type NoteDocument,
  type NoteRow,
  type Problem,
  type SearchHit,
  type TreeProject,
} from './bita.ts'
import { must } from './dom.ts'
import { renderRail, type RailState } from './notes/rail.ts'
import { renderReader, type ReaderState } from './notes/reader.ts'
import { FALLBACK_SECTIONS } from './notes/sections.ts'

const railHost = must<HTMLElement>('#rail')
const readerHost = must<HTMLElement>('#reader')

let projects: TreeProject[] = []
let docCount = 0
let sections: readonly string[] = FALLBACK_SECTIONS
let rows = new Map<string, NoteRow[]>()
let expanded = new Set<string>()
let selected: number | null = null
let opened: NoteDocument | null = null
let query = ''
let results: SearchHit[] | null = null
let hit = 0
let hitCount = 0
let failure: Problem | null = null
let loadingTree = true
let loadingDoc = false

let railPainted = ''
let readerPainted = ''
let searchToken = 0
let spy: IntersectionObserver | null = null

function railState(): RailState {
  return {
    projects,
    rows,
    expanded,
    selected,
    query,
    results,
    docCount,
    loading: loadingTree,
  }
}

function readerState(): ReaderState {
  const order = flatOrder()
  const at = selected === null ? -1 : order.indexOf(selected)
  return {
    document: opened,
    sections,
    query,
    hit,
    hitCount,
    failure,
    loading: loadingDoc,
    canPrev: at > 0,
    canNext: at !== -1 && at < order.length - 1,
  }
}

function railSignature(): string {
  const loaded = [...rows.entries()].map(([slug, list]) => `${slug}:${list.length}`).join(',')
  return [
    projects.length,
    docCount,
    [...expanded].sort().join('|'),
    loaded,
    selected ?? 'none',
    query,
    results === null ? 'pending' : results.map((entry) => entry.entryId).join('.'),
    loadingTree,
  ].join('~')
}

function readerSignature(): string {
  return [
    selected ?? 'none',
    opened?.doc?.relPath ?? 'none',
    opened?.doc?.file.status ?? 'none',
    query,
    hit,
    hitCount,
    failure?.message ?? '',
    loadingDoc,
  ].join('~')
}

function paint(): void {
  const rail = railSignature()
  if (rail !== railPainted) {
    railPainted = rail
    renderRail(railHost, railState(), {
      onQuery: runQuery,
      onToggle: toggleProject,
      onSelect: select,
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
    })
    afterReaderPaint()
  }
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

function watchSections(): void {
  spy?.disconnect()
  const blocks = [...readerHost.querySelectorAll<HTMLElement>('.doc-section[data-heading]')]
  if (blocks.length === 0) return

  spy = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)[0]
      if (!visible) return
      const heading = (visible.target as HTMLElement).dataset['heading'] ?? ''
      for (const item of readerHost.querySelectorAll<HTMLElement>('.toc-item')) {
        const on = item.dataset['heading'] === heading
        item.classList.toggle('toc-item--on', on)
        if (on) item.setAttribute('aria-current', 'true')
        else item.removeAttribute('aria-current')
      }
    },
    { root: readerHost.querySelector('.doc-body'), rootMargin: '-10% 0px -70% 0px' },
  )
  for (const block of blocks) spy.observe(block)
}

function flatOrder(): number[] {
  if (query.trim().length > 0 && results !== null) {
    return results.map((entry) => entry.entryId)
  }

  const order: number[] = []
  for (const project of projects) {
    if (!expanded.has(project.projectSlug)) continue
    for (const entry of rows.get(project.projectSlug) ?? []) {
      if (entry.doc !== null) order.push(entry.entryId)
    }
  }
  return order
}

function step(delta: number): void {
  const order = flatOrder()
  if (order.length === 0) return
  const at = selected === null ? -1 : order.indexOf(selected)
  const next = order[at === -1 ? 0 : Math.min(order.length - 1, Math.max(0, at + delta))]
  if (next !== undefined && next !== selected) select(next)
}

function select(entryId: number): void {
  selected = entryId
  hit = 0
  paint()
  void loadDocument(entryId)
}

async function loadDocument(entryId: number): Promise<void> {
  loadingDoc = true
  failure = null
  paint()

  try {
    const payload = await notesDocument(entryId)
    if (selected !== entryId) return
    opened = payload.data
    if (payload.meta.sections?.length) sections = payload.meta.sections
    loadingDoc = false
  } catch (error) {
    if (selected !== entryId) return
    loadingDoc = false
    failure = describeProblem(error)
  }
  paint()
}

function toggleProject(slug: string): void {
  if (expanded.has(slug)) expanded.delete(slug)
  else {
    expanded.add(slug)
    if (!rows.has(slug)) void loadProject(slug)
  }
  paint()
}

async function loadProject(slug: string): Promise<void> {
  const project = projects.find((entry) => entry.projectSlug === slug)
  const name = project?.projectId === null ? '_no-project' : (project?.projectName ?? null)

  try {
    const payload = await notesList(name, 0, 0)
    rows.set(slug, payload.data)
  } catch (error) {
    rows.set(slug, [])
    failure = describeProblem(error)
  }
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
    projects = payload.data.projects
    docCount = payload.meta.totals.docCount
    if (payload.meta.sections?.length) sections = payload.meta.sections
    failure = null
  } catch (error) {
    failure = describeProblem(error)
  }
  loadingTree = false
  paint()
}

async function focusOn(entryId: number): Promise<void> {
  const project = projects.find((entry) =>
    (rows.get(entry.projectSlug) ?? []).some((row) => row.entryId === entryId),
  )
  if (project) expanded.add(project.projectSlug)
  select(entryId)
}

function keys(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null
  const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault()
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
    rows = new Map()
    void loadTree()
    if (selected !== null) void loadDocument(selected)
  })
  onNotesFocus((entryId) => {
    void focusOn(entryId)
  })

  paint()
  await loadTree()

  const focus = await notesTakeFocus()
  if (focus !== null) await focusOn(focus)
}

void start()
