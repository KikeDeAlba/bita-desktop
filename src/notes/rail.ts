import type { NoteRow, SearchHit, TreeProject } from '../bita.ts'
import { element, icon } from '../dom.ts'
import { projectColor } from '../tabs.ts'

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]

export interface RailHandlers {
  onQuery: (value: string) => void
  onToggle: (slug: string) => void
  onSelect: (entryId: number) => void
}

export interface RailState {
  projects: TreeProject[]
  rows: Map<string, NoteRow[]>
  expanded: Set<string>
  selected: number | null
  query: string
  results: SearchHit[] | null
  docCount: number
  loading: boolean
}

export function monthLabel(month: string): string {
  const [year, index] = month.split('-')
  const name = MONTHS[Number(index) - 1] ?? month
  return `${name} ${year ?? ''}`.trim()
}

export function dayOf(localDay: string): string {
  return localDay.slice(8, 10)
}

export function renderRail(host: HTMLElement, state: RailState, handlers: RailHandlers): void {
  const head = element('div', 'rail-head')
  head.setAttribute('data-tauri-drag-region', '')
  const mark = element('span', 'rail-mark')
  mark.append(icon('doc', 15))
  const wordmark = element('span', 'rail-wordmark', 'notas')
  const count = element('span', 'rail-count', String(state.docCount))
  head.append(mark, wordmark, count)

  const search = element('div', 'rail-search')
  const field = element('label', 'search-field')
  const glass = element('span', 'search-glass')
  glass.append(icon('search', 13))
  const input = document.createElement('input')
  input.type = 'search'
  input.id = 'rail-query'
  input.placeholder = 'Buscar en las notas…'
  input.autocomplete = 'off'
  input.spellcheck = false
  input.value = state.query
  input.addEventListener('input', () => {
    handlers.onQuery(input.value)
  })
  const label = element('span', 'visually-hidden', 'Buscar en las notas')
  label.setAttribute('for', 'rail-query')
  field.append(glass, input)
  search.append(label, field)

  const body = element('div', 'rail-body')
  body.setAttribute('role', 'tree')
  body.setAttribute('aria-label', 'Notas por proyecto')

  if (state.query.trim().length > 0) {
    renderResults(body, state, handlers)
  } else {
    renderTree(body, state, handlers)
  }

  host.replaceChildren(head, search, body)
}

function renderTree(body: HTMLElement, state: RailState, handlers: RailHandlers): void {
  const withNotes = state.projects.filter((project) => project.docCount > 0)
  const withoutNotes = state.projects.filter((project) => project.docCount === 0)

  if (state.projects.length === 0) {
    const empty = element('p', 'rail-empty', state.loading ? 'Leyendo…' : 'Todavía no hay nada medido.')
    body.append(empty)
    return
  }

  if (withNotes.length > 0 && withoutNotes.length > 0) {
    body.append(element('div', 'rail-group', 'Con notas'))
  }
  for (const project of withNotes) body.append(...projectBlock(project, state, handlers))

  if (withoutNotes.length > 0) {
    if (withNotes.length > 0) body.append(element('div', 'rail-group', 'Solo tiempo medido'))
    for (const project of withoutNotes) body.append(...projectBlock(project, state, handlers))
  }
}

function projectBlock(project: TreeProject, state: RailState, handlers: RailHandlers): HTMLElement[] {
  const slug = project.projectSlug
  const open = state.expanded.has(slug)
  const quiet = project.docCount === 0

  const row = document.createElement('button')
  row.type = 'button'
  row.className = quiet ? 'project-row project-row--quiet' : 'project-row'
  row.setAttribute('role', 'treeitem')
  row.setAttribute('aria-expanded', String(open))

  const chevron = element('span', 'project-chevron')
  chevron.append(icon(open ? 'chevronDown' : 'chevronRight', 12))

  const dot = element('span', 'dot')
  dot.style.background = project.docCount > 0 ? projectColor(project.projectId) : 'transparent'
  if (project.docCount === 0) dot.style.border = '1px solid var(--elev-strong)'

  const name = element('span', 'project-name', project.projectName ?? 'Sin proyecto')
  const tally = element('span', 'project-count', quiet ? String(project.entryCount) : String(project.docCount))

  row.append(chevron, dot, name, tally)
  row.addEventListener('click', () => {
    handlers.onToggle(slug)
  })

  if (!open) return [row]

  const children = element('div', 'project-children')
  const rows = state.rows.get(slug)

  if (rows === undefined) {
    children.append(element('p', 'rail-empty', 'Leyendo…'))
    return [row, children]
  }

  if (rows.length === 0) {
    children.append(element('p', 'rail-empty', 'Nada medido aquí todavía.'))
    return [row, children]
  }

  let month = ''
  for (const entry of rows) {
    if (entry.month !== month) {
      month = entry.month
      children.append(element('div', 'month-label', monthLabel(month)))
    }
    children.append(noteRow(entry, state.selected === entry.entryId, handlers))
  }

  return [row, children]
}

function noteRow(entry: NoteRow, selected: boolean, handlers: RailHandlers): HTMLElement {
  if (entry.doc === null) {
    const missing = element('div', 'note-row note-row--empty')
    missing.append(element('span', 'note-day', dayOf(entry.localDay)))
    const text = element('span', 'note-text')
    text.append(element('span', 'note-title', entry.title.trim() || 'Sin título'))
    text.append(element('span', 'pill pill--empty', 'sin nota'))
    missing.append(text)
    missing.addEventListener('click', () => {
      handlers.onSelect(entry.entryId)
    })
    return missing
  }

  const row = document.createElement('button')
  row.type = 'button'
  row.className = selected ? 'note-row note-row--on' : 'note-row'
  row.setAttribute('role', 'treeitem')
  row.setAttribute('aria-level', '2')
  row.setAttribute('aria-selected', String(selected))

  row.append(element('span', 'note-day', dayOf(entry.localDay)))
  const text = element('span', 'note-text')
  text.append(element('span', 'note-title', entry.doc.docTitle || entry.title || 'Sin título'))
  const written = entry.doc.sections?.filter((section) => section.state === 'written').length ?? 0
  const total = entry.doc.sections?.filter((section) => section.canonical).length ?? 7
  text.append(element('span', 'note-meta', `${entry.durationHuman} · ${written} de ${total} secciones`))
  row.append(text)

  row.addEventListener('click', () => {
    handlers.onSelect(entry.entryId)
  })
  return row
}

function renderResults(body: HTMLElement, state: RailState, handlers: RailHandlers): void {
  if (state.results === null) {
    body.append(element('p', 'rail-empty', 'Buscando…'))
    return
  }

  if (state.results.length === 0) {
    body.append(element('p', 'rail-empty', `Nada coincide con «${state.query.trim()}».`))
    return
  }

  const tally = element(
    'div',
    'rail-tally',
    `${state.results.length} ${state.results.length === 1 ? 'nota' : 'notas'}`,
  )
  body.append(tally)

  let project = '\u0000'
  for (const hit of state.results) {
    if (hit.projectSlug !== project) {
      project = hit.projectSlug
      const header = element('div', 'result-project')
      const dot = element('span', 'dot')
      dot.style.background = projectColor(hit.projectId)
      header.append(dot, element('span', '', hit.projectName ?? 'Sin proyecto'))
      body.append(header)
    }
    body.append(resultRow(hit, state.selected === hit.entryId, handlers))
  }
}

function resultRow(hit: SearchHit, selected: boolean, handlers: RailHandlers): HTMLElement {
  const row = document.createElement('button')
  row.type = 'button'
  row.className = selected ? 'result-row result-row--on' : 'result-row'

  const head = element('span', 'result-head')
  head.append(element('span', 'result-title', hit.docTitle || hit.title))
  head.append(element('span', 'result-count', String(hit.matchCount)))
  row.append(head)

  const first = hit.matches[0]
  if (first) {
    const snippet = element('span', 'result-snippet')
    snippet.append(document.createTextNode(first.prefix.replace(/\s+/g, ' ')))
    snippet.append(element('mark', 'hit', first.match))
    snippet.append(document.createTextNode(first.suffix.replace(/\s+/g, ' ')))
    row.append(snippet)
  }

  row.append(element('span', 'result-meta', `${hit.localDay.slice(5)} · ${hit.relPath.split('/').pop() ?? ''}`))
  row.addEventListener('click', () => {
    handlers.onSelect(hit.entryId)
  })
  return row
}
