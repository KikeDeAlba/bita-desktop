import { element } from '../dom.ts'
import {
  dayBuckets,
  dayLabel,
  entryStart,
  hours,
  hourValue,
  NO_PROJECT,
  jiraShare,
  jiraStatus,
  jiraSummary,
  OTHERS_COLOR,
  percent,
  plural,
  projectKey,
  projectLabel,
  rangeLabel,
  weekBuckets,
  type Bucket,
} from './model.ts'
import type { ExportInclude, GroupBy, ReportView } from './types.ts'

const PAPER_BARS = 6

export interface PaperOptions {
  include: ExportInclude
  groupBy: GroupBy
  generated: string
  colors: Map<string, string>
}

export function paper(report: ReportView, options: PaperOptions): HTMLElement {
  const sheet = element('article', 'paper')
  const jira = options.include.jira && report.jiraAvailable

  const header = element('header', 'paper-header')
  const left = element('div')
  const kicker = report.projects.length === 1 ? `Reporte de tiempo · ${projectLabel(report.projects[0])}` : 'Reporte de tiempo'
  left.append(element('div', 'paper-kicker', kicker), element('h2', 'paper-title', rangeLabel(report.range.fromDay, report.range.toDay)))
  const right = element('div', 'paper-meta')
  right.append(element('span', undefined, plural(report.entryCount, 'entrada de bita', 'entradas de bita')), element('br'))
  right.append(element('span', undefined, `generado el ${dayLabel(options.generated, true)}`))
  header.append(left, right)
  sheet.append(header)

  const average = report.activeDays > 0 ? report.totalSeconds / report.activeDays : 0
  const stats: [string, string][] = [
    [hours(report.totalSeconds), 'medidas'],
    [hours(average), 'por día'],
    [String(report.projects.length), report.projects.length === 1 ? 'proyecto' : 'proyectos'],
  ]
  if (jira) {
    const summary = jiraSummary(report.projects)
    stats.push([jiraShare(summary.registered, summary.tracked), 'en Jira'])
  } else {
    stats.push([String(report.entryCount), 'entradas'])
  }
  const grid = element('div', 'paper-stats')
  for (const [value, label] of stats) {
    const stat = element('div', 'paper-stat')
    stat.append(element('span', 'paper-stat-value', value), element('span', 'paper-stat-label', label))
    grid.append(stat)
  }
  sheet.append(grid)

  if (options.include.charts) {
    sheet.append(projectBars(report, options.colors), dayColumns(report))
  }
  if (options.include.projects) sheet.append(groupTable(report, options.groupBy, jira))
  if (options.include.entries) sheet.append(entryTable(report, jira))

  const footer = element('footer', 'paper-footer')
  footer.append(element('span', undefined, jira ? 'Fuente: bita · Jira vía tally' : 'Fuente: bita'), element('span', undefined, 'Den'))
  sheet.append(footer)
  return sheet
}

function block(title: string): HTMLElement {
  const section = element('section', 'paper-block')
  section.append(element('div', 'paper-label', title))
  return section
}

function projectBars(report: ReportView, colors: Map<string, string>): HTMLElement {
  const section = block('Horas por proyecto')
  const rows = report.projects.slice(0, PAPER_BARS).map((project) => ({
    name: projectLabel(project),
    seconds: project.totalSeconds,
    color: colors.get(projectKey(project.projectId)) ?? OTHERS_COLOR,
  }))
  const rest = report.projects.slice(PAPER_BARS)
  if (rest.length > 0) {
    rows.push({ name: `Otros ${rest.length}`, seconds: rest.reduce((sum, project) => sum + project.totalSeconds, 0), color: OTHERS_COLOR })
  }
  const peak = Math.max(...rows.map((row) => row.seconds), 1)
  for (const row of rows) {
    const line = element('div', 'paper-bar')
    const track = element('div', 'paper-bar-track')
    const fill = element('div', 'paper-bar-fill')
    fill.style.width = `${((row.seconds / peak) * 100).toFixed(1)}%`
    fill.style.background = row.color
    track.append(fill)
    line.append(element('span', 'paper-bar-name', row.name), track, element('span', 'paper-num', hours(row.seconds)))
    section.append(line)
  }
  return section
}

function dayColumns(report: ReportView): HTMLElement {
  const section = block('Horas por día')
  const plot = element('div', 'paper-columns')
  const days = dayBuckets(report)
  const peak = Math.max(...days.map((day) => day.seconds), 3600)
  for (const day of days) {
    const column = element('div', 'paper-column')
    column.title = `${day.tip} · ${hours(day.seconds)}`
    const bar = element('div', 'paper-column-bar')
    bar.style.height = `${day.seconds > 0 ? Math.max((day.seconds / peak) * 100, 2) : 0}%`
    column.append(bar)
    plot.append(column)
  }
  const axis = element('div', 'paper-axis')
  const first = days[0]
  const last = days[days.length - 1]
  axis.append(element('span', undefined, first === undefined ? '' : first.tip), element('span', undefined, last === undefined ? '' : last.tip))
  section.append(plot, axis)
  return section
}

function table(headers: [string, boolean][]): { table: HTMLElement; body: HTMLElement } {
  const node = element('table', 'paper-table')
  const head = element('thead')
  const row = element('tr')
  for (const [label, right] of headers) {
    const th = element('th', right ? 'paper-right' : undefined, label)
    th.setAttribute('scope', 'col')
    row.append(th)
  }
  head.append(row)
  const body = element('tbody')
  node.append(head, body)
  return { table: node, body }
}

function cells(row: HTMLElement, values: [string, string?][]): void {
  for (const [text, className] of values) row.append(element('td', className, text))
}

function groupTable(report: ReportView, groupBy: GroupBy, jira: boolean): HTMLElement {
  if (groupBy === 'project') {
    const section = block('Por proyecto')
    const headers: [string, boolean][] = [
      ['Proyecto', false],
      ['Horas', true],
      ['%', true],
      ['Entradas', true],
    ]
    if (jira) headers.push(['Jira', true])
    const built = table(headers)
    for (const project of report.projects) {
      const row = element('tr')
      const values: [string, string?][] = [
        [projectLabel(project), 'paper-strong'],
        [hourValue(project.totalSeconds), 'paper-right paper-num paper-strong'],
        [percent(project.totalSeconds, report.totalSeconds).replace(' %', ''), 'paper-right paper-num'],
        [String(project.entryCount), 'paper-right paper-num'],
      ]
      if (jira) values.push([jiraStatus(project).text, 'paper-right'])
      cells(row, values)
      built.body.append(row)
    }
    section.append(built.table)
    return section
  }
  const buckets: Bucket[] = groupBy === 'day' ? dayBuckets(report).filter((bucket) => bucket.seconds > 0) : weekBuckets(report)
  const section = block(groupBy === 'day' ? 'Por día' : 'Por semana')
  const built = table([
    [groupBy === 'day' ? 'Día' : 'Semana', false],
    ['Horas', true],
    ['%', true],
    ['Proyectos', true],
  ])
  for (const bucket of buckets) {
    const row = element('tr')
    cells(row, [
      [bucket.tip, 'paper-strong'],
      [hourValue(bucket.seconds), 'paper-right paper-num paper-strong'],
      [percent(bucket.seconds, report.totalSeconds).replace(' %', ''), 'paper-right paper-num'],
      [String(bucket.projects.filter((item) => item.seconds > 0).length), 'paper-right paper-num'],
    ])
    built.body.append(row)
  }
  section.append(built.table)
  return section
}

function entryTable(report: ReportView, jira: boolean): HTMLElement {
  const section = block('Entradas')
  const entries = [...(report.entries ?? [])].sort((a, b) => a.start.localeCompare(b.start))
  if (entries.length === 0) {
    section.append(element('p', 'paper-empty', 'Sin entradas en el rango.'))
    return section
  }
  const names = new Map(report.projects.map((project) => [projectKey(project.projectId), projectLabel(project)]))
  const perEntry = jira && entries.some((entry) => entry.registered !== null)
  const headers: [string, boolean][] = [
    ['Inicio', false],
    ['Entrada', false],
    ['Proyecto', false],
    ['Horas', true],
  ]
  if (perEntry) headers.push(['Jira', true])
  const built = table(headers)
  for (const entry of entries) {
    const row = element('tr')
    const values: [string, string?][] = [
      [entryStart(entry), 'paper-num paper-nowrap'],
      [entry.title.trim() || 'Sin título', 'paper-strong'],
      [names.get(projectKey(entry.projectId)) ?? NO_PROJECT],
      [hourValue(entry.seconds), 'paper-right paper-num paper-strong'],
    ]
    if (perEntry) values.push([entry.registered === true ? (entry.issueKey ?? 'registrado') : entry.registered === false ? 'pendiente' : '', 'paper-right'])
    cells(row, values)
    built.body.append(row)
  }
  section.append(built.table)
  return section
}
