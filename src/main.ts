import {
  addProject,
  amendTimer,
  describeProblem,
  discardTimer,
  doctorReport,
  onSnapshot,
  pending,
  projects,
  refresh,
  scopes,
  setScope,
  snapshot,
  startTimer,
  stopTimer,
  unsetScope,
  worked,
  type LiveTimer,
  type Problem,
  type Project,
  type Scope,
  type Snapshot,
  type SummaryView,
} from './bita.ts'
import { element, iconButton, must } from './dom.ts'
import { clock, human, startedAt } from './format.ts'
import { renderSettings } from './settings.ts'
import { projectColor, renderPending, renderRepos, renderWorked } from './tabs.ts'

const TABS = ['ahora', 'hoy', 'jira', 'repos'] as const

type Tab = (typeof TABS)[number]

const view = must<HTMLElement>('#view')
const todayTotal = must<HTMLElement>('#today-total')
const barMark = must<HTMLElement>('.bar-mark')
const launcher = must<HTMLElement>('#launcher')
const launchForm = must<HTMLFormElement>('#launch-form')
const launchTitle = must<HTMLInputElement>('#launch-title')
const launchBlank = must<HTMLButtonElement>('#launch-blank')
const tabStrip = must<HTMLElement>('.tabs')
const gear = must<HTMLButtonElement>('#open-settings')

let tab: Tab = 'ahora'
let latest: Snapshot = { running: [], todaySeconds: 0, problem: null }
let catalog: Project[] = []
let scopeList: Scope[] = []
let workedRange: 'today' | 'week' = 'today'
let editing: number | null = null
let draftTitle = ''
let draftProject = ''
let confirmingDiscard = false
let failure: Problem | null = null
let painted = ''
let busy = false
let inSettings = false

function isTab(value: string): value is Tab {
  return (TABS as readonly string[]).includes(value)
}

function signature(): string {
  if (latest.problem !== null) return `problem:${latest.problem.message}`
  const timers = latest.running
    .map((timer) => `${timer.id}:${timer.draft}:${timer.title}:${timer.projectName}`)
    .join('|')
  return `${timers}::${editing}::${failure?.message ?? ''}::${confirmingDiscard}`
}

async function act(run: () => Promise<Snapshot>): Promise<void> {
  if (busy) return
  busy = true
  failure = null
  try {
    latest = await run()
  } catch (error) {
    failure = describeProblem(error)
  } finally {
    busy = false
    painted = ''
    paint()
  }
}

function busyView(): void {
  view.replaceChildren(element('p', 'placeholder', 'Preguntando al CLI…'))
}

function failureView(error: unknown): void {
  const problem = describeProblem(error)
  view.replaceChildren()
  const box = element('div', 'problem')
  box.append(element('p', 'problem-message', problem.message))
  if (problem.hint !== null) box.append(element('code', 'problem-hint', problem.hint))
  view.append(box)
}

function stopButton(timer: LiveTimer): HTMLButtonElement {
  const button = iconButton('stop', 'stop', `Parar el cronómetro ${timer.id}`)
  button.addEventListener('click', () => void act(() => stopTimer(timer.id)))
  return button
}

function projectPill(timer: LiveTimer): HTMLElement {
  if (timer.projectName === null) {
    return element('span', 'pill pill--empty', 'sin proyecto')
  }
  const pill = element('span', 'pill')
  const dot = element('i', 'dot')
  dot.style.background = projectColor(timer.projectId)
  pill.append(dot, element('span', undefined, timer.projectName))
  return pill
}

function timerCard(timer: LiveTimer): HTMLElement {
  const card = element('article', timer.draft ? 'timer timer--draft' : 'timer')
  card.dataset['id'] = String(timer.id)

  const title = element('p', 'timer-title')
  if (timer.draft) {
    title.append(element('span', 'timer-unnamed', 'Sin nombre todavía'))
    title.append(element('span', 'timer-id', `#${timer.id}`))
  } else {
    title.textContent = timer.title ?? ''
  }
  card.append(title)

  const row = element('div', 'timer-row')
  row.append(projectPill(timer))
  row.append(element('span', 'timer-since', `desde ${startedAt(timer.startLocal)}`))

  const face = element('span', 'timer-clock', clock(timer.elapsedSeconds))
  face.dataset['clock'] = String(timer.id)
  row.append(face, stopButton(timer))
  card.append(row)

  if (editing === timer.id) {
    card.append(editForm(timer))
  } else if (timer.draft) {
    const name = element('button', 'wide-button', 'Ponerle nombre') as HTMLButtonElement
    name.type = 'button'
    name.addEventListener('click', () => {
      editing = timer.id
      draftTitle = timer.title ?? ''
      draftProject = timer.projectId === null ? '' : String(timer.projectId)
      confirmingDiscard = false
      painted = ''
      paint()
    })
    card.append(name)
  }

  return card
}

function editForm(timer: LiveTimer): HTMLElement {
  const form = element('div', 'edit')

  const titleField = element('label', 'field')
  titleField.append(element('span', 'field-label', 'Título'))
  const input = document.createElement('input')
  input.type = 'text'
  input.value = draftTitle
  input.placeholder = '¿En qué has estado?'
  input.autocomplete = 'off'
  input.spellcheck = false
  input.addEventListener('input', () => {
    draftTitle = input.value
  })
  titleField.append(input)
  form.append(titleField)

  const projectField = element('label', 'field')
  projectField.append(element('span', 'field-label', 'Proyecto'))
  const select = document.createElement('select')
  const none = document.createElement('option')
  none.value = ''
  none.textContent = 'Dejarlo sin proyecto'
  select.append(none)
  for (const project of catalog) {
    const option = document.createElement('option')
    option.value = String(project.id)
    option.textContent = project.name
    select.append(option)
  }
  select.value = draftProject
  select.addEventListener('change', () => {
    draftProject = select.value
  })
  projectField.append(select)
  form.append(projectField)

  const actions = element('div', 'edit-actions')

  const discard = element(
    'button',
    'quiet-link quiet-link--danger',
    confirmingDiscard ? '¿Seguro? Se pierde el tiempo' : 'Descartar',
  ) as HTMLButtonElement
  discard.type = 'button'
  discard.addEventListener('click', () => {
    if (!confirmingDiscard) {
      confirmingDiscard = true
      painted = ''
      paint()
      return
    }
    editing = null
    confirmingDiscard = false
    void act(() => discardTimer(timer.id))
  })

  const cancel = element('button', 'ghost-button', 'Cancelar') as HTMLButtonElement
  cancel.type = 'button'
  cancel.addEventListener('click', () => {
    editing = null
    confirmingDiscard = false
    painted = ''
    paint()
  })

  const save = element('button', 'primary-button', 'Guardar') as HTMLButtonElement
  save.type = 'button'
  save.addEventListener('click', () => {
    const title = draftTitle.trim()
    const project = draftProject === '' ? null : draftProject
    if (title === '' && project === null) {
      failure = {
        kind: 'cli-failed',
        message: 'Ponle al menos un título o un proyecto.',
        hint: null,
      }
      painted = ''
      paint()
      return
    }
    editing = null
    confirmingDiscard = false
    void act(() => amendTimer(timer.id, title === '' ? null : title, project))
  })

  actions.append(discard, element('span', 'spacer'), cancel, save)
  form.append(actions)
  return form
}

function problemBlock(problem: Problem): HTMLElement {
  const box = element('div', 'problem')
  box.append(element('p', 'problem-message', problem.message))
  if (problem.hint !== null) box.append(element('code', 'problem-hint', problem.hint))
  return box
}

function renderAhora(): void {
  view.replaceChildren()

  if (latest.problem !== null) {
    view.append(problemBlock(latest.problem))
    return
  }

  if (failure !== null) view.append(problemBlock(failure))

  if (latest.running.length === 0) {
    const empty = element('div', 'empty')
    empty.append(element('p', 'empty-title', 'El reloj está parado'))
    empty.append(element('p', 'empty-note', `Hoy has medido ${human(latest.todaySeconds)}.`))
    view.append(empty)
    return
  }

  const list = element('div', 'timers')
  for (const timer of latest.running) list.append(timerCard(timer))
  view.append(list)

  if (latest.running.length > 1) {
    view.append(
      element(
        'p',
        'note',
        `${latest.running.length} cronómetros a la vez: hoy suman más que el reloj.`,
      ),
    )
  }
}

function tickClocks(): void {
  for (const timer of latest.running) {
    const face = view.querySelector<HTMLElement>(`[data-clock="${timer.id}"]`)
    if (face !== null) face.textContent = clock(timer.elapsedSeconds)
  }
}

function paint(): void {
  todayTotal.textContent = human(latest.todaySeconds)
  barMark.dataset['idle'] = String(latest.running.length === 0)
  launcher.hidden = inSettings || tab !== 'ahora' || editing !== null

  if (inSettings || tab !== 'ahora') return

  const current = signature()
  if (current === painted) {
    tickClocks()
    return
  }
  painted = current
  renderAhora()
}

async function loadWorked(): Promise<void> {
  busyView()
  try {
    const data: SummaryView = await worked(workedRange)
    if (tab !== 'hoy') return
    renderWorked(view, data, workedRange, (next) => {
      workedRange = next
      void loadWorked()
    })
  } catch (error) {
    if (tab === 'hoy') failureView(error)
  }
}

async function loadPending(): Promise<void> {
  busyView()
  try {
    const data = await pending()
    if (tab === 'jira') renderPending(view, data)
  } catch (error) {
    if (tab === 'jira') failureView(error)
  }
}

async function loadRepos(): Promise<void> {
  busyView()
  try {
    ;[scopeList, catalog] = await Promise.all([scopes(), projects()])
    if (tab !== 'repos') return
    renderRepos(view, scopeList, catalog, {
      onAddProject: (name) => void reposAction(() => addProject(name), 'projects'),
      onAddScope: (prefix, project) => void reposAction(() => setScope(prefix, project), 'scopes'),
      onRemoveScope: (prefix) => void reposAction(() => unsetScope(prefix), 'scopes'),
    })
  } catch (error) {
    if (tab === 'repos') failureView(error)
  }
}

async function reposAction(
  run: () => Promise<Project[] | Scope[]>,
  kind: 'projects' | 'scopes',
): Promise<void> {
  if (busy) return
  busy = true
  try {
    const result = await run()
    if (kind === 'projects') catalog = result as Project[]
    else scopeList = result as Scope[]
    busy = false
    await loadRepos()
  } catch (error) {
    busy = false
    failureView(error)
  }
}

async function showSettings(): Promise<void> {
  inSettings = true
  tabStrip.hidden = true
  launcher.hidden = true
  painted = ''
  busyView()
  try {
    const report = await doctorReport()
    if (!inSettings) return
    renderSettings(
      view,
      report,
      () => {
        inSettings = false
        tabStrip.hidden = false
        showTab(tab)
      },
      () => {
        void showSettings()
      },
    )
  } catch (error) {
    if (inSettings) failureView(error)
  }
}

function showTab(next: Tab): void {
  inSettings = false
  tabStrip.hidden = false
  tab = next
  painted = ''
  launcher.hidden = next !== 'ahora'
  if (next === 'ahora') {
    paint()
    return
  }
  if (next === 'hoy') void loadWorked()
  if (next === 'jira') void loadPending()
  if (next === 'repos') void loadRepos()
}

async function start(): Promise<void> {
  const tabs = document.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  for (const button of tabs) {
    button.addEventListener('click', () => {
      const name = button.dataset['tab']
      if (name === undefined || !isTab(name)) return
      for (const other of tabs) other.setAttribute('aria-selected', String(other === button))
      showTab(name)
    })
  }

  launchForm.addEventListener('submit', (event) => {
    event.preventDefault()
    const title = launchTitle.value.trim()
    launchTitle.value = ''
    void act(() => startTimer(title === '' ? null : title, null))
  })

  launchBlank.addEventListener('click', () => {
    launchTitle.value = ''
    void act(() => startTimer(null, null))
  })

  gear.addEventListener('click', () => {
    if (inSettings) {
      inSettings = false
      tabStrip.hidden = false
      showTab(tab)
      return
    }
    void showSettings()
  })

  onSnapshot((value) => {
    latest = value
    if (!inSettings) paint()
  })

  latest = await snapshot()
  paint()

  try {
    latest = await refresh()
  } catch (error) {
    latest = { running: [], todaySeconds: 0, problem: describeProblem(error) }
  }
  paint()

  if (latest.problem !== null) {
    void showSettings()
    return
  }

  try {
    catalog = await projects()
  } catch {
    catalog = []
  }
}

void start()
