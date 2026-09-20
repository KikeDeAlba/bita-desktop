import { onSnapshot, refresh, snapshot, type LiveTimer, type Snapshot } from './bita.ts'
import { clock, human, startedAt } from './format.ts'

const TABS = ['ahora', 'hoy', 'jira', 'repos'] as const

type Tab = (typeof TABS)[number]

const SOON: Record<Tab, string> = {
  ahora: '',
  hoy: 'Lo trabajado hoy y esta semana',
  jira: 'Lo que falta por registrar',
  repos: 'Proyectos y las rutas que cubren',
}

const PROJECT_COLORS = [
  'var(--aqua)',
  'var(--blue)',
  'var(--purple)',
  'var(--ok)',
  'var(--estimate)',
] as const

let current: Tab = 'ahora'
let rendered = ''

const view = must<HTMLElement>('#view')
const todayTotal = must<HTMLElement>('#today-total')
const barMark = must<HTMLElement>('.bar-mark')

function must<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector)
  if (found === null) throw new Error(`falta ${selector} en el panel`)
  return found
}

function isTab(value: string): value is Tab {
  return (TABS as readonly string[]).includes(value)
}

function projectColor(projectId: number | null): string {
  if (projectId === null) return 'var(--fg-faint)'
  return PROJECT_COLORS[projectId % PROJECT_COLORS.length] ?? 'var(--fg-faint)'
}

function signatureOf(value: Snapshot): string {
  if (value.problem !== null) return `problem:${value.problem.kind}:${value.problem.message}`
  return value.running.map((timer) => `${timer.id}:${timer.draft}:${timer.projectName}`).join('|')
}

function element(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  if (className !== undefined) node.className = className
  if (text !== undefined) node.textContent = text
  return node
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

  const pill = element('span', timer.projectName === null ? 'pill pill--empty' : 'pill')
  if (timer.projectName === null) {
    pill.append(element('span', undefined, 'sin proyecto'))
  } else {
    const dot = element('i', 'dot')
    dot.style.background = projectColor(timer.projectId)
    pill.append(dot, element('span', undefined, timer.projectName))
  }
  row.append(pill)

  row.append(element('span', 'timer-since', `desde ${startedAt(timer.startLocal)}`))

  const face = element('span', 'timer-clock', clock(timer.elapsedSeconds))
  face.dataset['clock'] = String(timer.id)
  row.append(face)

  card.append(row)
  return card
}

function problemBlock(value: Snapshot): HTMLElement {
  const box = element('div', 'problem')
  box.append(element('p', 'problem-message', value.problem?.message ?? ''))
  const hint = value.problem?.hint
  if (hint !== null && hint !== undefined) {
    box.append(element('code', 'problem-hint', hint))
  }
  return box
}

function renderAhora(value: Snapshot): void {
  view.replaceChildren()

  if (value.problem !== null) {
    view.append(problemBlock(value))
    return
  }

  if (value.running.length === 0) {
    const empty = element('div', 'empty')
    empty.append(element('p', 'empty-title', 'El reloj está parado'))
    empty.append(
      element('p', 'empty-note', `Hoy has medido ${human(value.todaySeconds)}.`),
    )
    view.append(empty)
    return
  }

  const list = element('div', 'timers')
  for (const timer of value.running) list.append(timerCard(timer))
  view.append(list)

  if (value.running.length > 1) {
    view.append(
      element(
        'p',
        'note',
        `${value.running.length} cronómetros a la vez: hoy suman más que el reloj.`,
      ),
    )
  }
}

function tickClocks(value: Snapshot): void {
  for (const timer of value.running) {
    const face = view.querySelector<HTMLElement>(`[data-clock="${timer.id}"]`)
    if (face !== null) face.textContent = clock(timer.elapsedSeconds)
  }
}

function paint(value: Snapshot): void {
  todayTotal.textContent = human(value.todaySeconds)
  barMark.dataset['idle'] = String(value.running.length === 0)

  if (current !== 'ahora') return

  const signature = signatureOf(value)
  if (signature === rendered) {
    tickClocks(value)
    return
  }
  rendered = signature
  renderAhora(value)
}

function showTab(tab: Tab, value: Snapshot): void {
  current = tab
  rendered = ''
  if (tab === 'ahora') {
    paint(value)
    return
  }
  view.replaceChildren(element('p', 'placeholder', SOON[tab]))
}

async function start(): Promise<void> {
  const tabs = document.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  let latest = await snapshot()

  for (const button of tabs) {
    button.addEventListener('click', () => {
      const name = button.dataset['tab']
      if (name === undefined || !isTab(name)) return
      for (const other of tabs) other.setAttribute('aria-selected', String(other === button))
      showTab(name, latest)
    })
  }

  onSnapshot((value) => {
    latest = value
    paint(value)
  })

  paint(latest)
  latest = await refresh()
  paint(latest)
}

void start()
