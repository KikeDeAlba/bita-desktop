import type { BacklogItem, Problem } from '../bita.ts'
import { element, icon } from '../dom.ts'
import { projectColor } from '../tabs.ts'

export type BacklogTab = 'finding' | 'pending' | 'resolved'

export const ALL_PROJECTS = 'all'
export const NO_PROJECT = 'none'

export interface BacklogState {
  items: BacklogItem[] | null
  tab: BacklogTab
  project: string
  query: string
  selectedId: number | null
  draft: string
  copied: string | null
  failure: Problem | null
  busy: Set<number>
  railOpen: boolean
  now: Date
}

export interface BacklogHandlers {
  onTab: (tab: BacklogTab) => void
  onProject: (project: string) => void
  onQuery: (query: string) => void
  onSelect: (id: number) => void
  onDraft: (text: string) => void
  onResolve: (id: number) => void
  onReopen: (id: number) => void
  onToPending: (id: number) => void
  onOpenPage: (pageId: number) => void
  onCopy: (text: string) => void
  onExpandRail: () => void
}

const TABS: { key: BacklogTab; label: string }[] = [
  { key: 'finding', label: 'Hallazgos' },
  { key: 'pending', label: 'Pendientes' },
  { key: 'resolved', label: 'Resueltos' },
]

const OLD_DAYS = 14
const DAY_MS = 86_400_000

export function itemKey(item: { id: number; key?: string }): string {
  return item.key ?? `#${item.id}`
}

export function tabOf(item: BacklogItem): BacklogTab {
  return item.status === 'resolved' ? 'resolved' : item.kind
}

export function projectOf(item: BacklogItem): string {
  return item.projectId === null ? NO_PROJECT : String(item.projectId)
}

export function openCount(items: BacklogItem[] | null): number {
  return (items ?? []).filter((item) => item.status === 'open').length
}

export function findByKey(items: BacklogItem[] | null, query: string): BacklogItem | undefined {
  const wanted = query.trim().replace(/^#/, '').toUpperCase()
  if (wanted.length === 0) return undefined
  return (items ?? []).find(
    (item) => itemKey(item).replace(/^#/, '').toUpperCase() === wanted || String(item.id) === wanted,
  )
}

function matchesQuery(item: BacklogItem, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return true
  return [itemKey(item), item.title, item.pageTitle ?? '', item.projectName ?? '']
    .some((field) => field.toLowerCase().includes(needle))
}

function byProject(left: BacklogItem, right: BacklogItem): number {
  const name = (left.projectName ?? '\uffff').localeCompare(right.projectName ?? '\uffff', 'es')
  if (name !== 0) return name
  if (left.status === 'resolved' && right.status === 'resolved') {
    return (right.resolvedAt ?? '').localeCompare(left.resolvedAt ?? '')
  }
  return left.createdAt.localeCompare(right.createdAt) || left.id - right.id
}

export function visibleItems(state: BacklogState): BacklogItem[] {
  return (state.items ?? [])
    .filter((item) => tabOf(item) === state.tab)
    .filter((item) => state.project === ALL_PROJECTS || projectOf(item) === state.project)
    .filter((item) => matchesQuery(item, state.query))
    .sort(byProject)
}

export function selectedItem(state: BacklogState): BacklogItem | undefined {
  const visible = visibleItems(state)
  return visible.find((item) => item.id === state.selectedId) ?? visible[0]
}

interface ProjectChip {
  value: string
  label: string
  projectId: number | null
  count: number
}

function projectChips(state: BacklogState): ProjectChip[] {
  const inTab = (state.items ?? []).filter((item) => tabOf(item) === state.tab)
  const chips = new Map<string, ProjectChip>()
  for (const item of state.items ?? []) {
    const value = projectOf(item)
    if (!chips.has(value)) {
      chips.set(value, { value, label: item.projectName ?? 'Sin proyecto', projectId: item.projectId, count: 0 })
    }
  }
  for (const item of inTab) {
    const chip = chips.get(projectOf(item))
    if (chip) chip.count += 1
  }
  const listed = [...chips.values()]
    .filter((chip) => chip.count > 0 || chip.value === state.project)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'es'))
  return [{ value: ALL_PROJECTS, label: 'Todos', projectId: null, count: inTab.length }, ...listed]
}

function daysSince(iso: string, now: Date): number {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return 0
  return Math.max(0, Math.floor((now.getTime() - then) / DAY_MS))
}

function shortAge(days: number): string {
  return days === 0 ? 'hoy' : `${days}d`
}

function longAge(days: number): string {
  if (days === 0) return 'hoy'
  return days === 1 ? 'hace 1 día' : `hace ${days} días`
}

export function renderBacklog(host: HTMLElement, state: BacklogState, handlers: BacklogHandlers): void {
  const focus = rememberFocus()
  const inbox = element('div', 'inbox')
  inbox.append(listPane(state, handlers), detailPane(state, handlers))
  host.replaceChildren(inbox)
  restoreFocus(host, focus)
}

interface FocusMemo {
  id: string
  start: number | null
  end: number | null
}

function rememberFocus(): FocusMemo | null {
  const active = document.activeElement
  if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) || active.id === '') return null
  return { id: active.id, start: active.selectionStart, end: active.selectionEnd }
}

function restoreFocus(host: HTMLElement, memo: FocusMemo | null): void {
  if (memo === null) return
  const target = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${CSS.escape(memo.id)}`)
  if (target === null) return
  target.focus()
  if (memo.start !== null && memo.end !== null) target.setSelectionRange(memo.start, memo.end)
}

function listPane(state: BacklogState, handlers: BacklogHandlers): HTMLElement {
  const pane = element('section', 'inbox-list')
  pane.setAttribute('aria-label', 'Pendientes y hallazgos')

  const bar = element('div', 'reader-bar inbox-bar')
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
  bar.append(tabList(state, handlers))
  pane.append(bar)

  const filters = element('div', 'inbox-filters')
  const field = element('label', 'search-field inbox-search')
  const glass = element('span', 'search-glass')
  glass.append(icon('search', 12))
  const input = document.createElement('input')
  input.type = 'search'
  input.id = 'inbox-query'
  input.placeholder = 'Filtrar, o ir a un ID como STI-14'
  input.autocomplete = 'off'
  input.spellcheck = false
  input.value = state.query
  input.setAttribute('aria-label', 'Filtrar por título o ID')
  input.addEventListener('input', () => {
    handlers.onQuery(input.value)
  })
  field.append(glass, input)
  filters.append(field, chipRow(state, handlers))
  pane.append(filters)

  const body = element('div', 'inbox-items')
  if (state.failure && state.items === null) {
    body.append(problemBlock(state.failure))
  } else if (state.items === null) {
    body.append(element('p', 'inbox-empty', 'Leyendo el backlog…'))
  } else {
    const visible = visibleItems(state)
    const current = selectedItem(state)
    if (visible.length === 0) body.append(element('p', 'inbox-empty', emptyText(state)))
    let group = '\u0000'
    for (const item of visible) {
      if (state.project === ALL_PROJECTS && projectOf(item) !== group) {
        group = projectOf(item)
        body.append(groupHead(item, visible.filter((other) => projectOf(other) === group).length))
      }
      body.append(itemRow(item, item.id === current?.id, state, handlers))
    }
  }
  pane.append(body)
  return pane
}

function tabList(state: BacklogState, handlers: BacklogHandlers): HTMLElement {
  const tabs = element('div', 'inbox-tabs')
  tabs.setAttribute('role', 'tablist')
  tabs.setAttribute('aria-label', 'Qué ver')
  for (const tab of TABS) {
    const count = (state.items ?? [])
      .filter((item) => tabOf(item) === tab.key)
      .filter((item) => state.project === ALL_PROJECTS || projectOf(item) === state.project).length
    const on = tab.key === state.tab
    const button = document.createElement('button')
    button.type = 'button'
    button.className = on ? 'inbox-tab inbox-tab--on' : 'inbox-tab'
    button.setAttribute('role', 'tab')
    button.setAttribute('aria-selected', String(on))
    button.append(element('span', '', tab.label), element('span', 'inbox-count', String(count)))
    button.addEventListener('click', () => {
      handlers.onTab(tab.key)
    })
    tabs.append(button)
  }
  return tabs
}

function chipRow(state: BacklogState, handlers: BacklogHandlers): HTMLElement {
  const row = element('div', 'inbox-chips')
  row.setAttribute('role', 'group')
  row.setAttribute('aria-label', 'Proyecto')
  for (const chip of projectChips(state)) {
    const on = chip.value === state.project
    const button = document.createElement('button')
    button.type = 'button'
    button.className = on ? 'inbox-chip inbox-chip--on' : 'inbox-chip'
    button.setAttribute('aria-pressed', String(on))
    if (chip.value !== ALL_PROJECTS) {
      const dot = element('span', 'dot')
      dot.style.background = projectColor(chip.projectId)
      button.append(dot)
    }
    button.append(element('span', '', chip.label), element('span', 'inbox-count', String(chip.count)))
    button.addEventListener('click', () => {
      handlers.onProject(chip.value)
    })
    row.append(button)
  }
  return row
}

function groupHead(item: BacklogItem, count: number): HTMLElement {
  const head = element('div', 'inbox-group')
  const dot = element('span', 'dot')
  dot.style.background = projectColor(item.projectId)
  head.append(dot, element('span', 'inbox-group-name', item.projectName ?? 'Sin proyecto'))
  head.append(element('span', 'inbox-count', String(count)))
  return head
}

function kindGlyph(item: BacklogItem): HTMLElement {
  const glyph = element('span', `inbox-glyph inbox-glyph--${item.status === 'resolved' ? 'done' : item.kind}`)
  glyph.setAttribute('aria-hidden', 'true')
  if (item.status === 'resolved') glyph.append(icon('check', 11))
  return glyph
}

function itemRow(item: BacklogItem, on: boolean, state: BacklogState, handlers: BacklogHandlers): HTMLElement {
  const row = document.createElement('button')
  row.type = 'button'
  row.className = on ? 'inbox-row inbox-row--on' : 'inbox-row'
  row.setAttribute('aria-current', String(on))

  const text = element('span', 'inbox-row-text')
  text.append(element('span', 'inbox-row-title', item.title))
  const meta = element('span', 'inbox-row-meta')
  meta.append(element('span', 'inbox-key', itemKey(item)))
  meta.append(element('span', 'inbox-sep', '·'))
  meta.append(element('span', 'inbox-row-page', item.pageTitle ?? 'Sin página'))
  text.append(meta)

  const days = daysSince(item.status === 'resolved' ? item.resolvedAt ?? item.updatedAt : item.createdAt, state.now)
  const age = element('span', 'inbox-age', shortAge(days))
  if (item.status === 'open' && days >= OLD_DAYS) age.classList.add('inbox-age--old')

  row.append(kindGlyph(item), text, age)
  row.addEventListener('click', () => {
    handlers.onSelect(item.id)
  })
  return row
}

function emptyText(state: BacklogState): string {
  if (state.query.trim().length > 0) return `Nada coincide con «${state.query.trim()}».`
  if (state.tab === 'pending') return 'No hay nada pendiente aquí.'
  if (state.tab === 'finding') return 'No hay hallazgos abiertos aquí.'
  return 'Todavía no se ha resuelto nada aquí.'
}

function problemBlock(failure: Problem): HTMLElement {
  const problem = element('div', 'problem')
  problem.append(element('p', 'problem-message', failure.message))
  if (failure.hint) problem.append(element('p', 'problem-hint', failure.hint))
  return problem
}

function detailPane(state: BacklogState, handlers: BacklogHandlers): HTMLElement {
  const pane = element('article', 'inbox-detail')
  pane.setAttribute('aria-label', 'Detalle')
  const bar = element('div', 'inbox-detail-bar')
  bar.setAttribute('data-tauri-drag-region', '')
  pane.append(bar)

  const item = state.items === null ? undefined : selectedItem(state)
  if (item === undefined) {
    const body = element('div', 'inbox-detail-body')
    body.append(element('p', 'inbox-empty', state.items === null ? '' : 'Elige un ítem de la lista.'))
    pane.append(body)
    return pane
  }

  const crumb = element('nav', 'inbox-crumb')
  crumb.append(element('span', '', item.projectName ?? 'Sin proyecto'))
  if (item.pageId !== null) {
    crumb.append(element('span', 'inbox-crumb-sep', '/'))
    const link = document.createElement('button')
    link.type = 'button'
    link.className = 'inbox-crumb-link'
    link.textContent = item.pageTitle ?? 'Página'
    const pageId = item.pageId
    link.addEventListener('click', () => {
      handlers.onOpenPage(pageId)
    })
    crumb.append(link)
  }
  bar.append(crumb)

  const body = element('div', 'inbox-detail-body')
  const key = itemKey(item)
  const head = element('div', 'inbox-detail-head')
  const copyKey = document.createElement('button')
  copyKey.type = 'button'
  copyKey.className = 'inbox-id'
  copyKey.setAttribute('aria-label', `Copiar el ID ${key}`)
  copyKey.append(element('span', '', state.copied === key ? 'Copiado' : key), icon('doc', 11))
  copyKey.addEventListener('click', () => {
    handlers.onCopy(key)
  })
  head.append(copyKey)

  const resolved = item.status === 'resolved'
  const kind = element(
    'span',
    `inbox-kind inbox-kind--${resolved ? 'done' : item.kind}`,
    resolved ? 'resuelto' : item.kind === 'pending' ? 'pendiente' : 'hallazgo',
  )
  head.append(kind)
  const origin = item.source === 'extracted' ? 'Extraído de una página' : 'Anotado a mano'
  const when = resolved
    ? `resuelto ${longAge(daysSince(item.resolvedAt ?? item.updatedAt, state.now))}`
    : longAge(daysSince(item.createdAt, state.now))
  head.append(element('span', 'inbox-origin', `${origin} · ${when}`))
  body.append(head)

  body.append(element('h1', 'inbox-title', item.title))
  if (item.body.trim().length > 0) body.append(element('p', 'inbox-body', item.body))

  if (!resolved) {
    const command = `cierra ${key}`
    const hint = element('div', 'inbox-hint')
    hint.append(icon('next', 12))
    const words = element('span', 'inbox-hint-text', 'Para cerrarlo desde Claude: ')
    words.append(element('code', '', command))
    hint.append(words)
    const copyCommand = document.createElement('button')
    copyCommand.type = 'button'
    copyCommand.className = 'inbox-hint-copy'
    copyCommand.textContent = state.copied === command ? 'Copiado' : 'Copiar'
    copyCommand.addEventListener('click', () => {
      handlers.onCopy(command)
    })
    hint.append(copyCommand)
    body.append(hint)
  }

  body.append(element('div', 'inbox-rule'))
  const busy = state.busy.has(item.id)

  if (resolved) {
    body.append(element('div', 'inbox-label', 'Cómo se resolvió'))
    body.append(
      element(
        'p',
        item.resolution.trim().length > 0 ? 'inbox-resolution' : 'inbox-resolution inbox-resolution--none',
        item.resolution.trim().length > 0 ? item.resolution : 'Se cerró sin nota.',
      ),
    )
  } else {
    const label = element('label', 'inbox-label', 'Cómo se resolvió')
    label.setAttribute('for', 'inbox-resolution')
    const area = document.createElement('textarea')
    area.id = 'inbox-resolution'
    area.className = 'inbox-draft'
    area.rows = 3
    area.placeholder = 'Una línea sobre lo que se hizo. Queda en el historial del ítem.'
    area.value = state.draft
    area.addEventListener('input', () => {
      handlers.onDraft(area.value)
    })
    body.append(label, area)
  }

  const actions = element('div', 'inbox-actions')
  if (resolved) {
    actions.append(actionButton('Reabrir', 'prev', 'inbox-action', busy, () => handlers.onReopen(item.id)))
  } else {
    actions.append(
      actionButton('Marcar resuelto', 'check', 'inbox-action inbox-action--primary', busy, () => handlers.onResolve(item.id)),
    )
    if (item.kind === 'finding') {
      actions.append(
        actionButton('Convertir en pendiente', 'next', 'inbox-action', busy, () => handlers.onToPending(item.id)),
      )
    }
  }
  if (item.pageId !== null) {
    const pageId = item.pageId
    actions.append(actionButton('Abrir la página', 'external', 'inbox-action', false, () => handlers.onOpenPage(pageId)))
  }
  body.append(actions)

  if (state.failure && state.items !== null) body.append(problemBlock(state.failure))
  pane.append(body)
  return pane
}

function actionButton(
  label: string,
  glyph: Parameters<typeof icon>[0],
  className: string,
  disabled: boolean,
  run: () => void,
): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.disabled = disabled
  button.append(icon(glyph, 12), element('span', '', label))
  button.addEventListener('click', run)
  return button
}
