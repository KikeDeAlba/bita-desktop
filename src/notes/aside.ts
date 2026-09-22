import type { DocHeading, PageDocument, PageEntryRow, PageIssue } from '../bita.ts'
import { element, icon } from '../dom.ts'

export interface AsideHandlers {
  onHeading: (anchor: string) => void
  onIssue: (url: string) => void
  onChild: (pageId: number) => void
  onEntry: (entryId: number) => void
  onCollapse: () => void
  onExpand: () => void
}

export interface AsideState {
  page: PageDocument | null
  active: string | null
  open: boolean
  logOpen: boolean
  onToggleLog: () => void
}

export function renderAside(host: HTMLElement, state: AsideState, handlers: AsideHandlers): void {
  host.classList.toggle('aside--closed', !state.open)

  if (!state.open) {
    host.replaceChildren(collapsedStrip(handlers))
    return
  }

  const head = element('div', 'aside-head')
  head.append(element('span', 'aside-title', 'En esta página'))
  const fold = document.createElement('button')
  fold.type = 'button'
  fold.className = 'icon-button'
  fold.setAttribute('aria-label', 'Plegar el panel')
  fold.append(icon('panelRight', 13))
  fold.addEventListener('click', handlers.onCollapse)
  head.append(fold)

  const body = element('div', 'aside-body')
  const page = state.page

  if (page === null) {
    body.append(element('p', 'aside-empty', 'Abre una página.'))
    host.replaceChildren(head, body)
    return
  }

  body.append(outlineBlock(page.doc.outline, state.active, handlers))

  if (page.issues.length > 0 || page.worklogIssues.length > 0) {
    body.append(divider())
    body.append(issuesBlock(page.issues, page.worklogIssues, handlers))
  }

  if (page.children.length > 0) {
    body.append(divider())
    body.append(childrenBlock(page, handlers))
  }

  if (page.entries.length > 0) {
    body.append(divider())
    body.append(logBlock(page.entries, state, handlers))
  }

  host.replaceChildren(head, body)
}

function collapsedStrip(handlers: AsideHandlers): HTMLElement {
  const strip = element('div', 'aside-strip')
  for (const [name, label] of [
    ['list', 'Secciones de la página'],
    ['task', 'Tareas de Jira'],
    ['clock', 'Registro de trabajo'],
  ] as const) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'strip-icon'
    button.setAttribute('aria-label', label)
    button.append(icon(name, 14))
    button.addEventListener('click', handlers.onExpand)
    strip.append(button)
  }
  return strip
}

function divider(): HTMLElement {
  return element('div', 'aside-divider')
}

function outlineBlock(outline: DocHeading[], active: string | null, handlers: AsideHandlers): HTMLElement {
  const block = element('div', 'aside-block')

  if (outline.length === 0) {
    block.append(element('p', 'aside-empty', 'Un solo bloque de texto.'))
    return block
  }

  for (const heading of outline) {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = heading.anchor === active ? 'toc-item toc-item--on' : 'toc-item'
    if (heading.level === 3) row.classList.add('toc-item--sub')
    row.append(element('span', 'toc-bar'))
    row.append(element('span', 'toc-text', heading.heading))
    row.addEventListener('click', () => {
      handlers.onHeading(heading.anchor)
    })
    block.append(row)
  }
  return block
}

function issuesBlock(issues: PageIssue[], worklog: string[], handlers: AsideHandlers): HTMLElement {
  const block = element('div', 'aside-block')
  block.append(element('div', 'aside-label', 'Tareas de Jira'))

  for (const issue of issues) {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'issue-row'
    row.disabled = issue.url === null

    const dot = element('span', 'dot')
    dot.style.background = categoryColor(issue.statusCategory)
    row.append(dot)

    const text = element('span', 'issue-text')
    text.append(element('span', 'issue-key', issue.issueKey))
    if (issue.summary.length > 0) text.append(element('span', 'issue-summary', issue.summary))
    row.append(text)

    if (issue.url !== null) {
      row.append(icon('external', 11))
      const url = issue.url
      row.addEventListener('click', () => {
        handlers.onIssue(url)
      })
    }
    block.append(row)
  }

  const documented = new Set(issues.map((issue) => issue.issueKey))
  const onlyWorklog = worklog.filter((key) => !documented.has(key))
  if (onlyWorklog.length > 0) {
    block.append(element('p', 'aside-note', `Con tiempo reportado pero sin documentar: ${onlyWorklog.join(', ')}.`))
  }

  return block
}

function childrenBlock(page: PageDocument, handlers: AsideHandlers): HTMLElement {
  const block = element('div', 'aside-block')
  block.append(element('div', 'aside-label', 'Subpáginas'))

  for (const child of page.children) {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'child-row'
    row.textContent = child.title
    row.addEventListener('click', () => {
      handlers.onChild(child.pageId)
    })
    block.append(row)
  }
  return block
}

function logBlock(entries: PageEntryRow[], state: AsideState, handlers: AsideHandlers): HTMLElement {
  const block = element('div', 'aside-block')

  const total = entries.reduce((sum, entry) => sum + entry.durationSeconds, 0)
  const header = document.createElement('button')
  header.type = 'button'
  header.className = 'log-head'
  header.setAttribute('aria-expanded', String(state.logOpen))
  header.append(icon(state.logOpen ? 'chevronDown' : 'chevronRight', 11))
  header.append(element('span', 'aside-label', 'Registro de trabajo'))
  header.append(element('span', 'log-total', humanise(total)))
  header.addEventListener('click', state.onToggleLog)
  block.append(header)

  if (!state.logOpen) return block

  for (const entry of entries) {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'log-row'

    const meta = element('span', 'log-meta')
    meta.append(element('span', 'log-day', entry.localDay.slice(5)))
    meta.append(element('span', 'log-length', entry.durationHuman))
    row.append(meta)

    const said = entry.summary.trim().length > 0 ? entry.summary : entry.title
    row.append(element('span', 'log-said', said))

    row.addEventListener('click', () => {
      handlers.onEntry(entry.entryId)
    })
    block.append(row)
  }

  return block
}

function humanise(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  if (hours === 0) return `${minutes}m`
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
}

function categoryColor(category: PageIssue['statusCategory']): string {
  if (category === 'done') return 'var(--ok)'
  if (category === 'indeterminate') return 'var(--estimate)'
  if (category === 'new') return 'var(--blue)'
  return 'var(--elev-strong)'
}
