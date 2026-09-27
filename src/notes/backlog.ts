import type { BacklogItem, BacklogStatus, Problem } from '../bita.ts'
import { element, icon } from '../dom.ts'
import { projectColor } from '../tabs.ts'

export type BacklogFilter = 'pending' | 'finding' | 'resolved'

export interface BacklogState {
  items: BacklogItem[] | null
  filter: BacklogFilter
  failure: Problem | null
  busy: Set<number>
  expanded: Set<number>
  railOpen: boolean
}

export interface BacklogHandlers {
  onFilter: (filter: BacklogFilter) => void
  onStatus: (id: number, status: BacklogStatus) => void
  onToggleItem: (id: number) => void
  onOpenPage: (pageId: number) => void
  onExpandRail: () => void
}

const FILTERS: { key: BacklogFilter; label: string }[] = [
  { key: 'pending', label: 'Pendientes' },
  { key: 'finding', label: 'Hallazgos' },
  { key: 'resolved', label: 'Resueltos' },
]

export function matchesFilter(item: BacklogItem, filter: BacklogFilter): boolean {
  if (filter === 'resolved') return item.status === 'resolved'
  return item.status === 'open' && item.kind === filter
}

export function openCount(items: BacklogItem[] | null): number {
  return (items ?? []).filter((item) => item.status === 'open').length
}

interface PageGroup {
  pageId: number | null
  title: string
  items: BacklogItem[]
}

interface ProjectGroup {
  projectId: number | null
  name: string
  pages: PageGroup[]
  count: number
}

export function groupItems(items: BacklogItem[]): ProjectGroup[] {
  const projects = new Map<string, ProjectGroup>()
  for (const item of items) {
    const projectKey = String(item.projectId ?? 'none')
    let project = projects.get(projectKey)
    if (!project) {
      project = { projectId: item.projectId, name: item.projectName ?? 'Sin proyecto', pages: [], count: 0 }
      projects.set(projectKey, project)
    }
    let page = project.pages.find((candidate) => candidate.pageId === item.pageId)
    if (!page) {
      page = { pageId: item.pageId, title: item.pageTitle ?? 'Sin página', items: [] }
      project.pages.push(page)
    }
    page.items.push(item)
    project.count += 1
  }
  const groups = [...projects.values()]
  for (const group of groups) {
    group.pages.sort((left, right) => {
      if (left.pageId === null) return 1
      if (right.pageId === null) return -1
      return left.title.localeCompare(right.title, 'es')
    })
  }
  return groups.sort((left, right) => left.name.localeCompare(right.name, 'es'))
}

export function renderBacklog(host: HTMLElement, state: BacklogState, handlers: BacklogHandlers): void {
  const bar = element('div', 'reader-bar')
  bar.setAttribute('data-tauri-drag-region', '')
  if (!state.railOpen) {
    const unfold = document.createElement('button')
    unfold.type = 'button'
    unfold.className = 'icon-button'
    unfold.setAttribute('aria-label', 'Desplegar el árbol')
    unfold.append(icon('panelLeft', 13))
    unfold.addEventListener('click', handlers.onExpandRail)
    bar.append(unfold)
  }
  bar.append(element('span', 'reader-crumb', 'Pendientes y hallazgos de todos los proyectos'))

  const header = element('div', 'doc-header backlog-header')
  header.append(element('h1', 'doc-title', 'Pendientes y hallazgos'))

  const chips = element('div', 'backlog-filters')
  chips.setAttribute('role', 'tablist')
  for (const filter of FILTERS) {
    const count = (state.items ?? []).filter((item) => matchesFilter(item, filter.key)).length
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = filter.key === state.filter ? 'backlog-chip backlog-chip--on' : 'backlog-chip'
    chip.setAttribute('role', 'tab')
    chip.setAttribute('aria-selected', String(filter.key === state.filter))
    chip.append(element('span', '', filter.label), element('span', 'backlog-chip-count', String(count)))
    chip.addEventListener('click', () => {
      handlers.onFilter(filter.key)
    })
    chips.append(chip)
  }
  header.append(chips)

  const body = element('div', 'doc-body')
  const article = element('div', 'article backlog')

  if (state.failure) {
    const problem = element('div', 'problem')
    problem.append(element('p', 'problem-message', state.failure.message))
    if (state.failure.hint) problem.append(element('p', 'problem-hint', state.failure.hint))
    article.append(problem)
  } else if (state.items === null) {
    article.append(element('p', 'backlog-empty', 'Leyendo el backlog…'))
  } else {
    const visible = state.items.filter((item) => matchesFilter(item, state.filter))
    if (visible.length === 0) {
      article.append(element('p', 'backlog-empty', emptyText(state.filter)))
    }
    for (const project of groupItems(visible)) article.append(projectBlock(project, state, handlers))
  }

  body.append(article)
  host.replaceChildren(bar, header, body)
}

function emptyText(filter: BacklogFilter): string {
  if (filter === 'pending') return 'No hay nada pendiente en ningún proyecto.'
  if (filter === 'finding') return 'No hay hallazgos abiertos.'
  return 'Todavía no se ha resuelto nada.'
}

function projectBlock(project: ProjectGroup, state: BacklogState, handlers: BacklogHandlers): HTMLElement {
  const block = element('section', 'backlog-project')
  const head = element('h2', 'backlog-project-head')
  const dot = element('span', 'dot')
  dot.style.background = projectColor(project.projectId)
  head.append(dot, element('span', 'backlog-project-name', project.name))
  head.append(element('span', 'backlog-project-count', String(project.count)))
  block.append(head)

  for (const page of project.pages) {
    const group = element('div', 'backlog-page')
    if (page.pageId !== null) {
      const link = document.createElement('button')
      link.type = 'button'
      link.className = 'backlog-page-link'
      link.textContent = page.title
      const pageId = page.pageId
      link.addEventListener('click', () => {
        handlers.onOpenPage(pageId)
      })
      group.append(link)
    } else {
      group.append(element('span', 'backlog-page-link backlog-page-link--none', page.title))
    }
    for (const item of page.items) group.append(itemRow(item, state, handlers))
    block.append(group)
  }
  return block
}

function itemRow(item: BacklogItem, state: BacklogState, handlers: BacklogHandlers): HTMLElement {
  const resolved = item.status === 'resolved'
  const row = element('div', resolved ? 'backlog-item backlog-item--done' : 'backlog-item')

  const check = document.createElement('button')
  check.type = 'button'
  check.className = 'backlog-check'
  check.disabled = state.busy.has(item.id)
  check.setAttribute('role', 'checkbox')
  check.setAttribute('aria-checked', String(resolved))
  check.setAttribute('aria-label', resolved ? `Reabrir: ${item.title}` : `Marcar resuelto: ${item.title}`)
  if (resolved) check.append(icon('check', 11))
  check.addEventListener('click', () => {
    handlers.onStatus(item.id, resolved ? 'open' : 'resolved')
  })

  const text = element('div', 'backlog-text')
  const title = document.createElement('button')
  title.type = 'button'
  title.className = 'backlog-title'
  title.setAttribute('aria-expanded', String(state.expanded.has(item.id)))
  title.disabled = item.body.trim().length === 0 && item.resolution.trim().length === 0
  title.append(element('span', `backlog-kind backlog-kind--${item.kind}`, item.kind === 'pending' ? 'pendiente' : 'hallazgo'))
  title.append(element('span', 'backlog-title-text', item.title))
  title.addEventListener('click', () => {
    handlers.onToggleItem(item.id)
  })
  text.append(title)

  if (state.expanded.has(item.id)) {
    if (item.body.trim().length > 0) text.append(element('p', 'backlog-body', item.body))
    if (resolved && item.resolution.trim().length > 0) {
      text.append(element('p', 'backlog-resolution', item.resolution))
    }
  }

  row.append(check, text)
  return row
}
