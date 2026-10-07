import type { DocHeading, PageBacklogItem, PageDocument, PageEntryRow, PageIssue, PageRef, SpaceAtlassian } from '../bita.ts'
import { element, icon } from '../dom.ts'
import { durationLabel, hasVideo, isRemote, minutesCounts, type MeetingContext } from './meeting.ts'

export interface AsideHandlers {
  onHeading: (anchor: string) => void
  onIssue: (url: string) => void
  onChild: (pageId: number) => void
  onEntry: (entryId: number) => void
  onBacklog: () => void
  onBacklogItem: (id: number) => void
  onCollapse: () => void
  onExpand: () => void
  onOpenFolder: (dir: string) => void
  onHit: (index: number) => void
}

export interface AsideState {
  page: PageDocument | null
  active: string | null
  open: boolean
  logOpen: boolean
  onToggleLog: () => void
  meeting: MeetingContext | null
  query: string
  hits: string[]
  hit: number
  atlassian: SpaceAtlassian | null
  custom: HTMLElement[] | null
}

export function renderAside(host: HTMLElement, state: AsideState, handlers: AsideHandlers): void {
  host.classList.toggle('aside--closed', !state.open)

  if (!state.open) {
    host.replaceChildren(collapsedStrip(handlers))
    return
  }

  const head = element('div', 'aside-head')
  head.append(element('span', 'aside-title', state.custom === null ? 'En esta página' : 'Resumen'))
  const fold = document.createElement('button')
  fold.type = 'button'
  fold.className = 'icon-button'
  fold.setAttribute('aria-label', 'Plegar el panel')
  fold.append(icon('panelRight', 13))
  fold.addEventListener('click', handlers.onCollapse)
  head.append(fold)

  const body = element('div', 'aside-body')
  const page = state.page

  if (state.custom !== null) {
    const block = element('div', 'aside-block')
    block.append(...state.custom)
    body.append(block)
    host.replaceChildren(head, body)
    return
  }

  if (page === null) {
    body.append(element('p', 'aside-empty', 'Abre una página.'))
    host.replaceChildren(head, body)
    return
  }

  if (state.query.trim().length > 0 && state.hits.length > 0) {
    body.append(hitsBlock(state, handlers), divider())
  }

  if (state.meeting !== null) {
    body.append(...meetingBlocks(state.meeting, handlers))
    body.append(divider())
  }

  body.append(outlineBlock(page.doc.outline, state.active, handlers))

  const sync = syncBlock(state.atlassian)
  if (sync !== null) body.append(divider(), sync)

  if (page.issues.length > 0 || page.worklogIssues.length > 0) {
    body.append(divider())
    body.append(issuesBlock(page.issues, page.worklogIssues, handlers))
  }

  if (page.children.length > 0) {
    body.append(divider())
    body.append(childrenBlock(page, handlers))
  }

  const open = (page.backlog ?? []).filter((item) => item.status === 'open')
  if (open.length > 0) {
    body.append(divider())
    body.append(backlogBlock(open, handlers))
  }

  if ((page.refs ?? []).length > 0) {
    body.append(divider())
    body.append(refsBlock(page.refs ?? [], handlers))
  }

  if (page.entries.length > 0) {
    body.append(divider())
    body.append(logBlock(page.entries, state, handlers))
  }

  host.replaceChildren(head, body)
}

function hitsBlock(state: AsideState, handlers: AsideHandlers): HTMLElement {
  const block = element('div', 'aside-block')
  block.append(element('div', 'aside-label', 'Coincidencias aquí'))
  state.hits.forEach((label, index) => {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = index === state.hit ? 'aside-hit aside-hit--on' : 'aside-hit'
    row.append(element('span', 'kbd', String(index + 1)), element('span', 'aside-hit-text', label))
    row.addEventListener('click', () => handlers.onHit(index))
    block.append(row)
  })
  return block
}

function syncAge(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000))
  if (Number.isNaN(minutes)) return iso.slice(0, 16)
  if (minutes < 1) return 'hace un momento'
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.round(hours / 24)
  return days === 1 ? 'hace 1 día' : `hace ${days} días`
}

function syncBlock(atlassian: SpaceAtlassian | null): HTMLElement | null {
  if (atlassian === null || atlassian.confluence === null) return null
  const block = element('div', 'aside-block')
  block.append(element('div', 'aside-label', 'Confluence'))
  const line = element('span', 'aside-sync')
  const dot = element('span', 'dot')
  const on = atlassian.sync.pull || atlassian.sync.push
  dot.style.background = on ? 'var(--aqua)' : 'var(--fg-faint)'
  const text = !on
    ? 'Sincronización apagada'
    : atlassian.sync.lastSyncAt === null
      ? 'Todavía no se sincroniza'
      : `Sincronizado ${syncAge(atlassian.sync.lastSyncAt)}`
  line.append(dot, element('span', '', text))
  block.append(line)
  return block
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

function backlogBlock(items: PageBacklogItem[], handlers: AsideHandlers): HTMLElement {
  const block = element('div', 'aside-block')
  const head = document.createElement('button')
  head.type = 'button'
  head.className = 'aside-label-link'
  head.append(element('span', 'aside-label', 'Pendientes y hallazgos'), element('span', 'log-total', String(items.length)))
  head.addEventListener('click', handlers.onBacklog)
  block.append(head)

  for (const item of items) {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'aside-backlog-row'
    row.title = item.kind === 'pending' ? 'Pendiente' : 'Hallazgo'
    row.append(element('span', `aside-backlog-key aside-backlog-key--${item.kind}`, item.key ?? `#${item.id}`))
    row.append(element('span', 'aside-backlog-text', item.title))
    row.addEventListener('click', () => {
      handlers.onBacklogItem(item.id)
    })
    block.append(row)
  }
  return block
}

const REF_LABEL: Record<PageRef['kind'], string> = {
  confluence: 'Confluence',
  jira: 'Jira',
  drive: 'Drive',
  link: 'Enlace',
}

function refsBlock(refs: PageRef[], handlers: AsideHandlers): HTMLElement {
  const block = element('div', 'aside-block')
  block.append(element('div', 'aside-label', 'Enlaces'))

  for (const ref of refs) {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'issue-row'
    row.title = ref.url
    const text = element('span', 'issue-text')
    text.append(element('span', 'issue-key', REF_LABEL[ref.kind]))
    text.append(element('span', 'issue-summary', ref.title.length > 0 ? ref.title : shortUrl(ref.url)))
    row.append(text, icon('external', 11))
    row.addEventListener('click', () => {
      handlers.onIssue(ref.url)
    })
    block.append(row)
  }
  return block
}

function shortUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname}${parsed.pathname}`.slice(0, 60)
  } catch {
    return url.slice(0, 60)
  }
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

function meetingBlocks(meeting: MeetingContext, handlers: AsideHandlers): HTMLElement[] {
  const blocks: HTMLElement[] = []
  const load = meeting.load

  if (load.state === 'ready' && load.view.summaryMarkdown !== null) {
    const counts = minutesCounts(load.view.summaryMarkdown)
    const block = element('div', 'aside-block')
    block.append(element('div', 'aside-label', 'En la minuta'))
    const grid = element('div', 'meeting-counts')
    for (const [value, label] of [
      [counts.agreements, counts.agreements === 1 ? 'acuerdo' : 'acuerdos'],
      [counts.pending, counts.pending === 1 ? 'pendiente' : 'pendientes'],
      [counts.questions, counts.questions === 1 ? 'pregunta' : 'preguntas'],
    ] as const) {
      const cell = element('div', 'meeting-count')
      cell.append(element('span', 'meeting-count-figure', String(value)), element('span', 'meeting-count-label', label))
      grid.append(cell)
    }
    block.append(grid)
    blocks.push(block, divider())
  }

  const block = element('div', 'aside-block')
  block.append(element('div', 'aside-label', 'Grabación'))
  const facts = element('div', 'meeting-facts')
  facts.append(
    element(
      'span',
      '',
      `${!isRemote(meeting.info) ? 'Micrófono' : load.state === 'ready' && !hasVideo(load.view) ? 'Sistema y micrófono, sin video' : 'Pantalla, sistema y micrófono'} · ${durationLabel(meeting.info.durationSeconds)}`,
    ),
  )
  if (load.state === 'ready') {
    facts.append(element('span', '', 'Transcrita con whisper'), element('span', '', 'Minuta por Claude'))
    block.append(facts)
    const open = document.createElement('button')
    open.type = 'button'
    open.className = 'ghost-button meeting-folder'
    open.append(icon('folder', 13), document.createTextNode('Abrir carpeta'))
    const dir = load.view.dir
    open.addEventListener('click', () => handlers.onOpenFolder(dir))
    block.append(open)
  } else {
    facts.append(
      element(
        'span',
        'aside-note',
        load.state === 'loading'
          ? 'Leyendo la reunión…'
          : load.state === 'missing'
            ? 'La grabación ya no está en este equipo.'
            : 'No pude leer la reunión.',
      ),
    )
    block.append(facts)
  }
  blocks.push(block)
  return blocks
}
