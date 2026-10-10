import type { Group, NonJira, Project, Scope, SummaryView, WorkedGroup, WorkedView } from './bita.ts'
import { element } from './dom.ts'
import { human } from './format.ts'

const PROJECT_COLORS = [
  'var(--aqua)',
  'var(--blue)',
  'var(--purple)',
  'var(--ok)',
  'var(--estimate)',
] as const

export function projectColor(projectId: number | null): string {
  if (projectId === null) return 'var(--fg-faint)'
  return PROJECT_COLORS[projectId % PROJECT_COLORS.length] ?? 'var(--fg-faint)'
}

export function pairOfTotals(
  workedSeconds: number,
  estimateSeconds: number,
  estimateLabel: string,
): HTMLElement {
  const row = workedTotals(workedSeconds)

  const right = element('div', 'total total--estimate')
  right.append(element('span', 'total-figure', `→ ${human(estimateSeconds)}`))
  right.append(element('span', 'total-label', estimateLabel))

  row.append(right)
  return row
}

function workedTotals(workedSeconds: number): HTMLElement {
  const row = element('div', 'totals')
  const left = element('div', 'total')
  left.append(element('span', 'total-figure', human(workedSeconds)))
  left.append(element('span', 'total-label', 'trabajado'))
  row.append(left)
  return row
}

function rowMeta(projectId: number | null, projectName: string | null, entryIds: number[], days: string[], extra = ''): HTMLElement {
  const meta = element('div', 'group-meta')
  const dot = element('i', 'dot')
  dot.style.background = projectColor(projectId)
  const blocks = entryIds.length === 1 ? '1 bloque' : `${entryIds.length} bloques`
  meta.append(dot, element('span', undefined, `${projectName ?? 'sin proyecto'} · ${blocks}${daySpan(days)}${extra}`))
  return meta
}

function daySpan(days: string[]): string {
  if (days.length <= 1) return ''
  return ` · ${days[0]?.slice(5) ?? ''}–${days[days.length - 1]?.slice(5) ?? ''}`
}

function groupRow(group: Group, widest: number): HTMLElement {
  const row = element('div', 'group')

  const head = element('div', 'group-head')
  const title = element('span', 'group-title', group.summary)
  const worked = element('span', 'group-worked', group.totalHuman)
  const estimate = element('span', 'group-estimate', group.jira ? `→ ${group.estimateHuman}` : 'sin Jira')
  head.append(title, worked, estimate)

  const part = group.partCount > 1 ? ` · parte ${group.partIndex}/${group.partCount}` : ''
  const meta = rowMeta(group.projectId, group.projectName, group.entryIds, group.days, part)

  const span100 = group.jira ? group.estimateSeconds : group.totalSeconds
  const track = element('div', group.jira ? 'meter-track' : 'meter-track meter-track--outside')
  track.style.width = `${Math.max(4, Math.round((span100 / widest) * 100))}%`
  const fill = element('div', 'meter-fill')
  const ratio = span100 === 0 ? 0 : group.totalSeconds / span100
  fill.style.width = `${Math.min(100, Math.round(ratio * 100))}%`
  track.append(fill)
  const meter = element('div', 'meter')
  meter.append(track)

  row.append(head, meta, meter)
  return row
}

function groupList(groups: Group[]): HTMLElement {
  const widest = groups.reduce(
    (most, group) => Math.max(most, group.jira ? group.estimateSeconds : group.totalSeconds),
    1,
  )
  const list = element('div', 'groups')
  for (const group of groups) list.append(groupRow(group, widest))
  return list
}

function workedRow(group: WorkedGroup, widest: number): HTMLElement {
  const row = element('div', 'group')

  const head = element('div', 'group-head')
  head.append(
    element('span', 'group-title', group.summary),
    element('span', 'group-worked', human(group.totalSeconds)),
    element('span', 'group-estimate', group.running ? 'corriendo' : ''),
  )

  const meta = rowMeta(group.projectId, group.projectName, group.entryIds, group.days)

  const track = element('div', 'meter-track')
  track.style.width = `${Math.max(4, Math.round((group.totalSeconds / widest) * 100))}%`
  const fill = element('div', 'meter-fill')
  fill.style.width = '100%'
  track.append(fill)
  const meter = element('div', 'meter')
  meter.append(track)

  row.append(head, meta, meter)
  return row
}

export function renderWorked(
  view: HTMLElement,
  data: WorkedView,
  range: 'today' | 'week',
  onRange: (next: 'today' | 'week') => void,
): void {
  view.replaceChildren()

  const header = element('div', 'section-head')
  header.append(workedTotals(data.totalSeconds))

  const toggle = element('div', 'segmented')
  for (const option of ['today', 'week'] as const) {
    const button = element(
      'button',
      option === range ? 'segmented-on' : undefined,
      option === 'today' ? 'Hoy' : 'Semana',
    ) as HTMLButtonElement
    button.type = 'button'
    button.addEventListener('click', () => onRange(option))
    toggle.append(button)
  }
  header.append(toggle)
  view.append(header)

  const days = new Set(data.groups.flatMap((group) => group.days))
  view.append(
    element(
      'p',
      'caption',
      `${data.groups.length} tareas · ${days.size} ${days.size === 1 ? 'día' : 'días'}`,
    ),
  )

  for (const overlap of data.overlaps) {
    const banner = element('div', 'banner')
    banner.append(
      element(
        'span',
        'banner-text',
        `${overlap.localDay.slice(5)}: ${human(overlap.trackedSeconds)} sobre ${human(
          overlap.clockSeconds,
        )} de reloj, ${human(overlap.overlapSeconds)} solapados.`,
      ),
    )
    view.append(banner)
  }

  if (data.groups.length === 0) {
    view.append(element('p', 'placeholder', 'Nada medido en este rango.'))
    return
  }

  const widest = data.groups.reduce((most, group) => Math.max(most, group.totalSeconds), 1)
  const list = element('div', 'groups')
  for (const group of data.groups) list.append(workedRow(group, widest))
  view.append(list)
}

function outsideJira(nonJira: NonJira | null): HTMLElement | null {
  if (nonJira === null || nonJira.totalSeconds === 0) return null
  const banner = element('div', 'banner banner--quiet')
  const names = nonJira.projects.map((project) => `${project.name ?? 'sin proyecto'} ${project.totalHuman}`).join(', ')
  banner.append(element('span', 'banner-text', `Fuera de Jira: ${nonJira.totalHuman} (${names}). Se mide, pero no se sube.`))
  return banner
}

export function renderPending(view: HTMLElement, data: SummaryView): void {
  view.replaceChildren()

  if (data.groups.length === 0) {
    const empty = element('div', 'empty')
    empty.append(element('p', 'empty-title', 'No hay nada pendiente'))
    empty.append(
      element('p', 'empty-note', 'Todo lo medido en los últimos 90 días ya está en Jira.'),
    )
    if (data.excluded.length > 0) {
      empty.append(element('p', 'empty-note', excludedLine(data)))
    }
    view.append(empty)
    const outside = outsideJira(data.nonJira)
    if (outside !== null) view.append(outside)
    return
  }

  view.append(pairOfTotals(data.totalSeconds, data.estimateSeconds, 'estimación original'))
  const worklogs = data.groups.reduce((count, group) => count + group.entryIds.length, 0)
  view.append(
    element(
      'p',
      'caption',
      `sin registrar · ${worklogs} worklogs en ${data.groups.length} tareas`,
    ),
  )
  view.append(groupList(data.groups))

  if (data.excluded.length > 0) {
    const banner = element('div', 'banner banner--quiet')
    banner.append(element('span', 'banner-text', excludedLine(data)))
    view.append(banner)
  }
  const outside = outsideJira(data.nonJira)
  if (outside !== null) view.append(outside)

  view.append(
    element('p', 'legend', 'Escribir en Jira lo hace Claude, que es quien tiene el conector.'),
  )
}

function excludedLine(data: SummaryView): string {
  const reasons = new Map<string, number>()
  for (const item of data.excluded) {
    reasons.set(item.reason, (reasons.get(item.reason) ?? 0) + 1)
  }
  const label: Record<string, string> = {
    running: 'corriendo ahora',
    'no-project': 'sin proyecto',
    'no-description': 'sin título',
    'zero-duration': 'menos de un minuto',
  }
  const parts = [...reasons].map(([reason, count]) => `${count} ${label[reason] ?? reason}`)
  return `Quedan fuera ${data.excluded.length}: ${parts.join(', ')}.`
}

export interface ReposHandlers {
  onAddProject: (name: string) => void
  onAddScope: (prefix: string, project: string) => void
  onRemoveScope: (prefix: string) => void
}

export function renderRepos(
  view: HTMLElement,
  scopes: Scope[],
  catalog: Project[],
  handlers: ReposHandlers,
): void {
  view.replaceChildren()

  view.append(element('p', 'section-label', 'Rutas que resuelven a un proyecto'))

  if (scopes.length === 0) {
    view.append(element('p', 'placeholder', 'Ninguna ruta mapeada todavía.'))
  } else {
    const list = element('div', 'scopes')
    for (const scope of scopes) list.append(scopeRow(scope, handlers))
    view.append(list)
  }

  view.append(scopeForm(catalog, handlers))

  view.append(
    element(
      'p',
      'legend',
      'Manda el prefijo más largo, y el empate es por carpetas: …/apartados nunca se traga …/apartados-legacy.',
    ),
  )

  view.append(element('p', 'section-label', `Proyectos (${catalog.length})`))
  const projects = element('div', 'projects')
  for (const project of catalog) {
    const row = element('div', 'project')
    const dot = element('i', 'dot')
    dot.style.background = projectColor(project.id)
    row.append(dot, element('span', 'project-name', project.name))
    if (!project.jira) {
      row.append(element('span', 'tag tag--muted', 'sin Jira'))
    } else if (project.jiraProjectKey !== null) {
      row.append(element('span', 'tag', project.jiraProjectKey))
    }
    projects.append(row)
  }
  view.append(projects)
  view.append(projectForm(handlers))
}

function scopeRow(scope: Scope, handlers: ReposHandlers): HTMLElement {
  const row = element('div', 'scope')

  const head = element('div', 'scope-head')
  const dot = element('i', 'dot')
  dot.style.background = projectColor(scope.projectId)
  head.append(dot, element('span', 'scope-project', scope.projectName))
  const remove = element('button', 'quiet-link quiet-link--danger', 'Quitar') as HTMLButtonElement
  remove.type = 'button'
  remove.addEventListener('click', () => handlers.onRemoveScope(scope.prefix))
  head.append(element('span', 'spacer'), remove)

  const path = element('p', 'scope-path')
  const cut = scope.prefix.lastIndexOf('/')
  if (cut === -1) {
    path.append(element('span', 'scope-leaf', scope.prefix))
  } else {
    path.append(element('span', 'scope-root', `${scope.prefix.slice(0, cut + 1)}`))
    path.append(element('span', 'scope-leaf', scope.prefix.slice(cut + 1)))
  }

  row.append(head, path)
  return row
}

function scopeForm(catalog: Project[], handlers: ReposHandlers): HTMLElement {
  const form = element('div', 'inline-form')

  const prefix = document.createElement('input')
  prefix.type = 'text'
  prefix.placeholder = 'gitlab.com/org/grupo'
  prefix.autocomplete = 'off'
  prefix.spellcheck = false
  prefix.setAttribute('aria-label', 'Prefijo de ruta')

  const select = document.createElement('select')
  select.setAttribute('aria-label', 'Proyecto de la ruta')
  const blank = document.createElement('option')
  blank.value = ''
  blank.textContent = 'Proyecto…'
  select.append(blank)
  for (const project of catalog) {
    const option = document.createElement('option')
    option.value = String(project.id)
    option.textContent = project.name
    select.append(option)
  }

  const add = element('button', 'ghost-button', 'Mapear') as HTMLButtonElement
  add.type = 'button'
  add.addEventListener('click', () => {
    if (prefix.value.trim() === '' || select.value === '') return
    handlers.onAddScope(prefix.value.trim(), select.value)
  })

  form.append(prefix, select, add)
  return form
}

function projectForm(handlers: ReposHandlers): HTMLElement {
  const form = element('div', 'inline-form')
  const name = document.createElement('input')
  name.type = 'text'
  name.placeholder = 'Nombre del proyecto'
  name.autocomplete = 'off'
  name.setAttribute('aria-label', 'Nombre del proyecto nuevo')

  const add = element('button', 'ghost-button', 'Crear') as HTMLButtonElement
  add.type = 'button'
  add.addEventListener('click', () => {
    if (name.value.trim() === '') return
    handlers.onAddProject(name.value.trim())
  })

  form.append(name, add)
  return form
}
