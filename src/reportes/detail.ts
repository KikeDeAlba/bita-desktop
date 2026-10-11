import { element, icon } from '../dom.ts'
import type { App, DetailState } from './app.ts'
import { jiraTag } from './dashboard.ts'
import {
  colorMap,
  dayLabel,
  entryStart,
  hours,
  isMeeting,
  jiraShare,
  isWeekend,
  OTHERS_COLOR,
  overlapFor,
  percent,
  plural,
  projectKey,
  projectLabel,
  rangeLabel,
} from './model.ts'
import type { ReportEntry, ReportProject, ReportView } from './types.ts'
import { card, columnChart, emptyState, kpis, loading, notice, primaryAction, problemState, segmented, swatch, type Column, type Kpi } from './ui.ts'

const THEME_LIMIT = 3
const PALETTE = ['var(--aqua)', 'var(--blue)', 'var(--purple)', 'var(--ok)', 'var(--estimate)']

export function detail(app: App, projectId: number | null): HTMLElement {
  const page = element('div', 'report-detail')
  const key = projectKey(projectId)
  const full = app.main.report
  const state = app.detail
  const summary = full?.projects.find((project) => projectKey(project.projectId) === key)
  const fromDetail = state?.report?.projects.find((project) => projectKey(project.projectId) === key)
  const project = summary ?? fromDetail
  const name = project === undefined ? 'Proyecto' : projectLabel(project)
  const color = full === null ? OTHERS_COLOR : (colorMap(full).get(key) ?? OTHERS_COLOR)

  const crumbs = element('nav', 'report-crumbs')
  crumbs.setAttribute('aria-label', 'Ruta')
  const back = element('button', 'report-crumb-back') as HTMLButtonElement
  back.type = 'button'
  back.dataset['key'] = 'back'
  back.append(icon('prev', 12), element('span', undefined, 'Tiempo por proyecto'))
  back.addEventListener('click', () => app.navigate({ name: 'dashboard' }))
  crumbs.append(back, element('span', undefined, '/'), element('span', 'report-crumb-here', name))
  page.append(crumbs)

  const header = element('header', 'report-header')
  const titles = element('div', 'report-titles')
  const line = element('div', 'report-title-line')
  line.append(swatch(color, 'report-title-dot'), element('h1', 'report-title', name))
  if (full?.jiraAvailable === true && project !== undefined) line.append(jiraTag(project))
  titles.append(line)
  header.append(titles)
  const exportButton = primaryAction('Exportar proyecto', () => app.openExport({ projectId }))
  exportButton.dataset['key'] = 'export-project'
  header.append(exportButton)
  page.append(header)

  if (state === null || state.loading) {
    titles.append(element('p', 'report-subtitle', full === null ? '' : rangeLabel(full.range.fromDay, full.range.toDay)))
    page.append(loading())
    return page
  }
  if (state.error !== null) {
    page.append(problemState(state.error, () => app.navigate({ name: 'detail', projectId })))
    return page
  }
  const report = state.report
  if (report === null) {
    page.append(loading())
    return page
  }

  const entries = (report.entries ?? []).filter((entry) => projectKey(entry.projectId) === key)
  const days = report.days.map((day) => ({
    day: day.day,
    seconds: day.projects.filter((item) => projectKey(item.projectId) === key).reduce((sum, item) => sum + item.seconds, 0),
  }))
  const total = project?.totalSeconds ?? days.reduce((sum, day) => sum + day.seconds, 0)
  const firstIndex = days.findIndex((day) => day.seconds > 0)
  const activeDays = days.filter((day) => day.seconds > 0).length
  const facts = [rangeLabel(report.range.fromDay, report.range.toDay)]
  const first = days[firstIndex]
  if (first !== undefined) facts.push(`primer registro el ${dayLabel(first.day)}`)
  facts.push(plural(activeDays, 'día con tiempo', 'días con tiempo'))
  titles.append(element('p', 'report-subtitle', facts.join(' · ')))

  if (total <= 0) {
    page.append(emptyState('Este proyecto no tiene tiempo en el rango', 'Vuelve al dashboard y elige otro rango.'))
    return page
  }

  if (report.jiraProblem !== null) page.append(notice(report.jiraProblem))
  page.append(summaryCards(full, project, total, entries))

  const pair = element('div', 'report-pair report-pair--detail')
  const chartCard = card('report-detail-days', 'Horas por día', 'Horas por día')
  const shown = firstIndex > 0 ? days.slice(firstIndex) : days
  const columns: Column[] = shown.map((day) => ({
    key: day.day,
    label: shown.length > 7 ? String(Number(day.day.slice(8, 10))) : dayLabel(day.day),
    tip: dayLabel(day.day),
    seconds: day.seconds,
    weekend: isWeekend(day.day),
    overlap: overlapFor(report, day.day),
  }))
  const dense = columns.length > 31
  chartCard.append(
    columnChart('Horas por día del proyecto', columns, {
      height: 180,
      color,
      goal: false,
      highlight: false,
      values: dense ? 'hide' : 'dash',
      minWidth: columns.length > 14 ? columns.length * 14 : 0,
      gap: dense ? 2 : columns.length > 14 ? 6 : 22,
      maxBar: 44,
    }),
  )
  pair.append(chartCard, themes(entries, color, total))
  page.append(pair)
  page.append(entryTable(app, state, entries, report))
  return page
}

function summaryCards(full: ReportView | null, project: ReportProject | undefined, total: number, entries: ReportEntry[]): HTMLElement {
  const count = project?.entryCount ?? entries.length
  const rank = full === null || project === undefined ? -1 : full.projects.indexOf(project)
  const items: Kpi[] = [
    {
      label: 'Horas',
      value: hours(total),
      note:
        full === null
          ? 'en el periodo'
          : `${percent(total, full.totalSeconds)} del periodo${rank >= 0 ? ` · ${rank + 1}.º de ${full.projects.length}` : ''}`,
    },
    { label: 'Entradas', value: String(count), note: count > 0 ? `${hours(total / count)} por entrada` : 'sin entradas' },
  ]
  const meetings = entries.filter(isMeeting)
  const meetingSeconds = meetings.reduce((sum, entry) => sum + entry.seconds, 0)
  const inPerson = meetings.filter((entry) => entry.kind === 'in-person-meeting').length
  items.push({
    label: 'Reuniones',
    value: hours(meetingSeconds),
    note:
      meetings.length === 0
        ? 'sin reuniones'
        : [plural(meetings.length, 'reunión', 'reuniones'), inPerson > 0 ? plural(inPerson, 'presencial', 'presenciales') : '']
            .filter(Boolean)
            .join(' · '),
  })
  if (full?.jiraAvailable === true && project !== undefined) items.push(projectJira(project, entries))
  return kpis(items, 180)
}

function projectJira(project: ReportProject, entries: ReportEntry[]): Kpi {
  if (project.jira !== true) return { label: 'En Jira', value: '—', note: 'proyecto sin Jira' }
  const registered = project.registeredSeconds
  const pending = project.pendingSeconds
  const tracked = registered + pending
  const logged = entries.filter((entry) => entry.registered === true).length
  const note =
    pending > 0
      ? `${hours(pending)} pendientes`
      : logged > 0
        ? plural(logged, 'worklog registrado', 'worklogs registrados')
        : `${hours(registered)} registradas`
  return {
    label: 'En Jira',
    value: jiraShare(registered, tracked),
    note,
    tone: pending > 0 ? 'estimate' : 'ok',
  }
}

function themes(entries: ReportEntry[], color: string, total: number): HTMLElement {
  const section = card('report-themes', 'En qué se fue el tiempo', 'En qué se fue el tiempo')
  const groups = new Map<string, number>()
  for (const entry of entries) {
    const name = isMeeting(entry)
      ? entry.kind === 'in-person-meeting'
        ? 'Reuniones presenciales'
        : 'Reuniones remotas'
      : entry.title.trim() || 'Sin título'
    groups.set(name, (groups.get(name) ?? 0) + entry.seconds)
  }
  if (groups.size === 0) {
    section.append(element('p', 'report-meta', 'Sin entradas en el rango.'))
    return section
  }
  const sorted = [...groups.entries()].sort((a, b) => b[1] - a[1])
  const palette = [color, ...PALETTE.filter((item) => item !== color)]
  const rows = sorted.slice(0, THEME_LIMIT).map(([name, seconds], index) => ({ name, seconds, color: palette[index] ?? OTHERS_COLOR }))
  const rest = sorted.slice(THEME_LIMIT).reduce((sum, [, seconds]) => sum + seconds, 0)
  if (rest > 0) rows.push({ name: 'Otros', seconds: rest, color: OTHERS_COLOR })
  const sum = rows.reduce((acc, row) => acc + row.seconds, 0) || total

  const strip = element('div', 'report-strip')
  strip.setAttribute('aria-hidden', 'true')
  for (const row of rows) {
    const part = element('div', 'report-strip-part')
    part.style.flex = `${row.seconds} 1 0`
    part.style.background = row.color
    part.title = row.name
    strip.append(part)
  }
  section.append(strip)
  const list = element('div', 'report-themes-list')
  for (const row of rows) {
    const line = element('div', 'report-theme')
    const label = element('span', 'report-theme-name', row.name)
    label.title = row.name
    line.append(
      swatch(row.color),
      label,
      element('span', 'report-num', hours(row.seconds)),
      element('span', 'report-num report-num--mute', `${Math.round((row.seconds / sum) * 100)} %`),
    )
    list.append(line)
  }
  section.append(list, element('p', 'report-footnote', 'Agrupado por el título de cada entrada de bita.'))
  return section
}

function entryTable(app: App, state: DetailState, entries: ReportEntry[], report: ReportView): HTMLElement {
  const section = element('section', 'report-card report-table-card')
  section.setAttribute('aria-label', 'Entradas')
  const head = element('div', 'report-table-head')
  head.append(element('h2', 'report-card-title report-grow', 'Entradas'))
  head.append(
    segmented<DetailState['sort']>(
      'Ordenar las entradas',
      [
        { id: 'date', label: 'Fecha' },
        { id: 'duration', label: 'Duración' },
      ],
      state.sort,
      (id) => {
        state.sort = id
        app.render()
      },
      'sort',
    ),
  )
  section.append(head)

  if (entries.length === 0) {
    section.append(element('p', 'report-table-empty', 'Sin entradas en el rango.'))
    return section
  }

  const withJira = report.jiraAvailable && entries.some((entry) => entry.registered !== null)
  const sorted = [...entries].sort((a, b) => (state.sort === 'duration' ? b.seconds - a.seconds : b.start.localeCompare(a.start)))
  const scroll = element('div', 'report-table-scroll')
  const table = element('table', 'report-table report-table--entries')
  const thead = element('thead')
  const headRow = element('tr')
  const columns: [string, string][] = [
    ['Inicio', 'report-col-start'],
    ['Entrada', ''],
    ['Duración', 'report-right report-col-duration'],
  ]
  if (withJira) columns.push(['Jira', 'report-col-jira'])
  for (const [label, className] of columns) {
    const th = element('th', className, label)
    th.setAttribute('scope', 'col')
    headRow.append(th)
  }
  thead.append(headRow)
  table.append(thead)
  const body = element('tbody')
  for (const entry of sorted) {
    const row = element('tr')
    const what = element('td')
    const title = element('div', 'report-entry-title')
    if (isMeeting(entry)) {
      const dot = element('span', 'report-meeting-dot')
      dot.title = 'Reunión'
      dot.setAttribute('role', 'img')
      dot.setAttribute('aria-label', 'Reunión')
      title.append(dot)
    }
    title.append(element('span', undefined, entry.title.trim() || 'Sin título'))
    what.append(title)
    if (entry.overlapping) {
      const warn = element('div', 'report-overlap')
      warn.append(icon('warning', 11), element('span', undefined, 'corrió junto a otros cronómetros'))
      what.append(warn)
    }
    row.append(element('td', 'report-num report-num--mute report-nowrap', entryStart(entry)), what, element('td', 'report-right report-num report-num--strong', hours(entry.seconds)))
    if (withJira) {
      const cell = element('td')
      if (entry.registered === true) cell.append(element('span', 'tag', entry.issueKey ?? 'registrado'))
      else if (entry.registered === false) cell.append(element('span', 'tag report-tag--pending', 'pendiente'))
      row.append(cell)
    }
    body.append(row)
  }
  table.append(body)
  scroll.append(table)
  section.append(scroll)
  return section
}
