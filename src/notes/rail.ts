import type { PageNode, SearchHit, Space } from '../bita.ts'
import { element, icon } from '../dom.ts'
import { projectColor } from '../tabs.ts'

export type Selection = { kind: 'page' | 'entry'; id: number } | null

export interface RailHandlers {
  onQuery: (value: string) => void
  onToggle: (key: string) => void
  onSelectPage: (pageId: number) => void
  onSelectEntry: (entryId: number) => void
  onCollapse: () => void
}

export interface RailState {
  spaces: Space[]
  expanded: Set<string>
  selected: Selection
  query: string
  results: SearchHit[] | null
  pageCount: number
  loading: boolean
  open: boolean
}

export function spaceKey(space: Space): string {
  return `space:${space.projectSlug}`
}

export function pageKey(page: PageNode): string {
  return `page:${page.pageId}`
}

export function renderRail(host: HTMLElement, state: RailState, handlers: RailHandlers): void {
  host.classList.toggle('rail--closed', !state.open)

  if (!state.open) {
    host.replaceChildren(collapsedStrip(state, handlers))
    return
  }

  const standing = host.querySelector<HTMLInputElement>('#rail-query')
  const body = standing === null ? freshChrome(host, state, handlers) : keepChrome(host, standing, state)

  if (state.query.trim().length > 0) renderResults(body, state, handlers)
  else renderTree(body, state, handlers)
}

function freshChrome(host: HTMLElement, state: RailState, handlers: RailHandlers): HTMLElement {
  const head = element('div', 'rail-head')
  head.setAttribute('data-tauri-drag-region', '')
  const wordmark = element('span', 'rail-wordmark', 'documentación')
  const fold = document.createElement('button')
  fold.type = 'button'
  fold.className = 'icon-button'
  fold.setAttribute('aria-label', 'Plegar el árbol')
  fold.append(icon('panelLeft', 13))
  fold.addEventListener('click', handlers.onCollapse)
  head.append(wordmark, fold)

  const search = element('div', 'rail-search')
  const field = element('label', 'search-field')
  const glass = element('span', 'search-glass')
  glass.append(icon('search', 13))
  const input = document.createElement('input')
  input.type = 'search'
  input.id = 'rail-query'
  input.placeholder = 'Buscar en la documentación…'
  input.autocomplete = 'off'
  input.spellcheck = false
  input.value = state.query
  input.addEventListener('input', () => {
    handlers.onQuery(input.value)
  })
  const label = element('span', 'visually-hidden', 'Buscar en la documentación')
  label.setAttribute('for', 'rail-query')
  field.append(glass, input)
  search.append(label, field)

  const body = element('div', 'rail-body')
  body.setAttribute('role', 'tree')
  body.setAttribute('aria-label', 'Espacios y páginas')

  host.replaceChildren(head, search, body)
  return body
}

function keepChrome(host: HTMLElement, input: HTMLInputElement, state: RailState): HTMLElement {
  if (input.value !== state.query) input.value = state.query

  const standing = host.querySelector<HTMLElement>('.rail-body')
  if (standing !== null) {
    standing.replaceChildren()
    return standing
  }

  const body = element('div', 'rail-body')
  body.setAttribute('role', 'tree')
  body.setAttribute('aria-label', 'Espacios y páginas')
  host.append(body)
  return body
}

function collapsedStrip(state: RailState, handlers: RailHandlers): HTMLElement {
  const strip = element('div', 'rail-strip')
  strip.setAttribute('data-tauri-drag-region', '')

  for (const space of state.spaces) {
    if (space.pageCount === 0) continue
    const dot = document.createElement('button')
    dot.type = 'button'
    dot.className = 'strip-dot'
    dot.setAttribute('aria-label', `Espacio ${space.projectName ?? 'sin proyecto'}`)
    const bead = element('span', 'dot')
    bead.style.background = projectColor(space.projectId)
    dot.append(bead)
    dot.addEventListener('click', handlers.onCollapse)
    strip.append(dot)
  }

  return strip
}

function renderTree(body: HTMLElement, state: RailState, handlers: RailHandlers): void {
  const withPages = state.spaces.filter((space) => space.pageCount > 0)
  const withoutPages = state.spaces.filter((space) => space.pageCount === 0)

  if (state.spaces.length === 0) {
    body.append(element('p', 'rail-empty', state.loading ? 'Leyendo…' : 'Todavía no hay nada medido.'))
    return
  }

  if (withPages.length === 0) {
    body.append(element('p', 'rail-empty', 'Ninguna página todavía.'))
  }

  for (const space of withPages) body.append(...spaceBlock(space, state, handlers))

  if (withoutPages.length > 0) {
    body.append(element('div', 'rail-group', 'Sin páginas'))
    for (const space of withoutPages) body.append(...spaceBlock(space, state, handlers))
  }
}

function spaceBlock(space: Space, state: RailState, handlers: RailHandlers): HTMLElement[] {
  const key = spaceKey(space)
  const open = state.expanded.has(key)
  const quiet = space.pageCount === 0

  const row = document.createElement('button')
  row.type = 'button'
  row.className = quiet ? 'project-row project-row--quiet' : 'project-row'
  row.setAttribute('role', 'treeitem')
  row.setAttribute('aria-level', '1')
  row.setAttribute('aria-expanded', String(open))

  const chevron = element('span', 'project-chevron')
  chevron.append(icon(open ? 'chevronDown' : 'chevronRight', 12))

  const dot = element('span', 'dot')
  dot.style.background = quiet ? 'transparent' : projectColor(space.projectId)
  if (quiet) dot.style.border = '1px solid var(--elev-strong)'

  const name = element('span', 'project-name', space.projectName ?? 'Sin proyecto')
  const tally = element('span', 'project-count', String(quiet ? space.entryCount : space.pageCount))

  row.append(chevron, dot, name, tally)
  row.addEventListener('click', () => {
    handlers.onToggle(key)
  })

  if (!open) return [row]

  const children = element('div', 'project-children')
  if (space.pages.length === 0) {
    children.append(element('p', 'rail-empty', 'Ninguna página en este espacio.'))
    return [row, children]
  }

  for (const page of space.pages) children.append(...pageBlock(page, state, handlers, 2))
  return [row, children]
}

function pageBlock(page: PageNode, state: RailState, handlers: RailHandlers, level: number): HTMLElement[] {
  const key = pageKey(page)
  const kids = page.children ?? []
  const open = state.expanded.has(key)
  const on = state.selected?.kind === 'page' && state.selected.id === page.pageId

  const row = document.createElement('button')
  row.type = 'button'
  row.className = on ? 'page-row page-row--on' : 'page-row'
  row.setAttribute('role', 'treeitem')
  row.setAttribute('aria-level', String(level))
  row.setAttribute('aria-selected', String(on))
  if (kids.length > 0) row.setAttribute('aria-expanded', String(open))

  const chevron = element('span', 'page-chevron')
  if (kids.length > 0) {
    chevron.append(icon(open ? 'chevronDown' : 'chevronRight', 11))
    chevron.addEventListener('click', (event) => {
      event.stopPropagation()
      handlers.onToggle(key)
    })
  }

  const name = element('span', 'page-name', page.title)
  row.append(chevron, name)
  if (page.issues.length > 0) {
    row.append(element('span', 'page-count', String(page.issues.length)))
  }

  row.addEventListener('click', () => {
    handlers.onSelectPage(page.pageId)
    if (kids.length > 0 && !open) handlers.onToggle(key)
  })

  if (kids.length === 0 || !open) return [row]

  const nest = element('div', 'page-children')
  for (const child of kids) nest.append(...pageBlock(child, state, handlers, level + 1))
  return [row, nest]
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

  body.append(
    element('div', 'rail-tally', `${state.results.length} ${state.results.length === 1 ? 'nota' : 'notas'}`),
  )

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
    body.append(resultRow(hit, state.selected?.kind === 'entry' && state.selected.id === hit.entryId, handlers))
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
    handlers.onSelectEntry(hit.entryId)
  })
  return row
}
