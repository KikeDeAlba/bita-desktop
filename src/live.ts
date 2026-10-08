import {
  backlogAdd,
  copyText,
  describeProblem,
  liveAsk,
  liveHide,
  liveSources,
  liveState,
  onLiveAnswer,
  onLiveState,
  onLiveTranscript,
  openExternal,
  openNotes,
  openSourceFile,
  type AnswerSource,
  type LiveAnswer,
  type LiveView,
  type MeetingSegment,
  type StreamEvent,
} from './bita.ts'
import { element, icon, must } from './dom.ts'
import { renderMarkdown } from './notes/markdown.ts'
import { shortcutLabel } from './shortcut.ts'

interface Current {
  askId: number
  question: string
  progress: string | null
  text: string
  sources: AnswerSource[]
  done: LiveAnswer | null
  error: { code: string; message: string } | null
}

const CHANNEL_LABEL: Record<string, string> = { mic: 'Sala', system: 'Remotos' }
const COPIED_MS = 1400
const ERROR_TEXT: Record<string, string> = {
  NOT_RECORDING: 'No se está grabando ninguna reunión.',
  NO_ACTIVE: 'No se está grabando ninguna reunión.',
}

const root = must<HTMLElement>('#live')

let view: LiveView = {
  active: null,
  title: null,
  entryId: null,
  project: null,
  transcript: [],
  answers: [],
  asking: false,
  shortcut: 'Ctrl+Alt+Space',
  visible: true,
}
let current: Current | null = null
let expanded: string | null = null
let repoCount: number | null = null
let sourcesFor: string | null = null
let draft = ''
let backlogged = new Set<string>()
let backlogBusy = new Set<string>()
let notice: string | null = null
let noticeTimer = 0

function clockOf(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const seconds = String(total % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`
}

function elapsedLabel(): string {
  const started = view.active?.startedAt
  if (started === null || started === undefined) return ''
  const since = Date.now() - new Date(started).getTime()
  if (!Number.isFinite(since)) return ''
  const total = Math.max(0, Math.floor(since / 1000))
  const hours = String(Math.floor(total / 3600)).padStart(2, '0')
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const seconds = String(total % 60).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}

function delayLabel(): string | null {
  const started = view.active?.startedAt
  const last = view.transcript.at(-1)
  if (started === null || started === undefined || last === undefined) return null
  const lag = Math.round((Date.now() - new Date(started).getTime() - last.endMs) / 1000)
  if (!Number.isFinite(lag) || lag < 0) return null
  return `~${lag} s de retraso`
}

function askedClock(answer: LiveAnswer): string {
  const started = view.active?.startedAt
  if (started === null || started === undefined) return answer.askedAt.slice(11, 16)
  const offset = new Date(answer.askedAt).getTime() - new Date(started).getTime()
  return Number.isFinite(offset) ? clockOf(offset) : answer.askedAt.slice(11, 16)
}

function flash(message: string): void {
  notice = message
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    notice = null
    paint()
  }, COPIED_MS)
  paint()
}

function copy(text: string): void {
  void copyText(text)
    .then(() => flash('Copiado'))
    .catch(() => flash('No se pudo copiar'))
}

function header(): HTMLElement {
  const bar = element('header', 'live-bar')
  bar.setAttribute('data-tauri-drag-region', '')
  const dot = element('span', view.active === null ? 'live-dot live-dot--idle' : 'live-dot')
  const title = element('span', 'live-title', view.title ?? (view.active === null ? 'Asistente de reunión' : 'Reunión en curso'))
  title.setAttribute('data-tauri-drag-region', '')
  const clock = element('span', 'live-clock', elapsedLabel())
  clock.dataset['clock'] = 'meeting'
  const spacer = element('span', 'spacer')
  spacer.setAttribute('data-tauri-drag-region', '')
  const badge = element('span', 'live-private')
  badge.title = 'Esta ventana no aparece cuando compartes pantalla'
  badge.append(icon('eyeOff', 12), element('span', '', 'Privada'))
  const hide = document.createElement('button')
  hide.type = 'button'
  hide.className = 'live-icon'
  hide.setAttribute('aria-label', 'Ocultar')
  hide.append(icon('minus', 14))
  hide.addEventListener('click', () => {
    void liveHide()
  })
  bar.append(dot, title, clock, spacer, badge, hide)
  return bar
}

function transcriptLine(segment: MeetingSegment, now: boolean): HTMLElement {
  const row = element('div', now ? 'live-line live-line--now' : 'live-line')
  row.append(element('span', 'live-stamp', clockOf(segment.startMs)))
  const text = element('span', 'live-said')
  if (view.active?.mode !== 'in-person') {
    text.append(element('b', `live-who live-who--${segment.channel}`, CHANNEL_LABEL[segment.channel] ?? segment.channel), ' ')
  }
  text.append(segment.text)
  row.append(text)
  return row
}

function transcriptPanel(full: boolean): HTMLElement {
  const section = element('section', full ? 'live-tail live-tail--full' : 'live-tail')
  section.setAttribute('aria-label', 'Transcripción en vivo')
  const settled = current !== null && (current.done !== null || current.error !== null)
  if (full) {
    const head = element('div', 'live-label')
    head.append(icon('bars', 11), element('span', '', 'TRANSCRIPCIÓN EN VIVO'), element('span', 'spacer'))
    const delay = delayLabel()
    if (delay !== null) head.append(element('span', 'live-delay', delay))
    section.append(head)
  } else if (!settled) {
    const head = element('div', 'live-label')
    head.append(icon('bars', 11), element('span', '', 'TRANSCRIPCIÓN EN VIVO'))
    section.append(head)
  }
  const lines = view.transcript
  if (lines.length === 0) {
    section.append(element('p', 'live-quiet', view.active === null ? 'No se está grabando ninguna reunión.' : 'Esperando las primeras frases…'))
    return section
  }
  const shown = full ? lines : lines.slice(settled ? -1 : -3)
  const list = element('div', 'live-lines')
  shown.forEach((segment, index) => {
    list.append(transcriptLine(segment, !full && index === shown.length - 1))
  })
  section.append(list)
  if (full) {
    const typing = element('div', 'live-typing')
    typing.append(element('i', ''), element('i', ''), element('i', ''))
    section.append(typing)
    queueMicrotask(() => {
      list.scrollTop = list.scrollHeight
    })
  }
  return section
}

function sourceChip(source: AnswerSource): HTMLElement {
  const kind = source.kind === 'page' || source.kind === 'file' || source.kind === 'commit' ? source.kind : 'file'
  const chip = document.createElement('button')
  chip.type = 'button'
  chip.className = `live-source live-source--${kind}`
  chip.append(icon(kind === 'page' ? 'doc' : kind === 'commit' ? 'commit' : 'code', 11), element('span', '', source.label))
  if (kind === 'page' && source.pageId !== undefined) {
    const pageId = source.pageId
    chip.title = 'Abrir la página en las notas'
    chip.addEventListener('click', () => {
      void openNotes(pageId).catch((error: unknown) => flash(describeProblem(error).message))
    })
  } else if (kind === 'file' && source.path !== undefined) {
    const path = source.path
    chip.title = source.line === undefined ? path : `${path}:${source.line}`
    chip.addEventListener('click', () => {
      void openSourceFile(path).catch((error: unknown) => flash(describeProblem(error).message))
    })
  } else if (kind === 'commit') {
    const sha = source.sha ?? source.label
    chip.title = 'Copiar el commit'
    chip.addEventListener('click', () => copy(sha))
  } else {
    chip.disabled = true
  }
  return chip
}

function decorateCode(fragment: DocumentFragment): void {
  for (const pre of fragment.querySelectorAll<HTMLElement>('pre.md-code')) {
    const text = pre.textContent ?? ''
    const wrap = element('div', 'live-code')
    pre.replaceWith(wrap)
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'live-code-copy'
    button.setAttribute('aria-label', 'Copiar comando')
    button.append(icon('copy', 13))
    button.addEventListener('click', () => copy(text))
    wrap.append(pre, button)
  }
}

function markdown(text: string, streaming: boolean): HTMLElement {
  const body = element('div', 'live-md')
  const fragment = renderMarkdown(text, {
    onCopy: copy,
    onLink: (url) => {
      void openExternal(url).catch(() => undefined)
    },
  })
  decorateCode(fragment)
  body.append(fragment)
  if (streaming) {
    const caret = element('span', 'live-caret')
    const last = body.lastElementChild
    if (last !== null && last.tagName === 'P') last.append(caret)
    else body.append(caret)
  }
  return body
}

function backlogButton(answer: LiveAnswer): HTMLElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'live-backlog'
  const done = backlogged.has(answer.id)
  const busy = backlogBusy.has(answer.id)
  button.disabled = done || busy
  button.append(icon(done ? 'check' : 'inbox', 11), element('span', '', done ? 'En el backlog' : busy ? 'Guardando…' : 'Al backlog'))
  button.addEventListener('click', () => {
    backlogBusy.add(answer.id)
    paint()
    void backlogAdd('pending', answer.question, answer.answer, null, view.project)
      .then(() => {
        backlogged.add(answer.id)
      })
      .catch((error: unknown) => flash(describeProblem(error).message))
      .finally(() => {
        backlogBusy.delete(answer.id)
        paint()
      })
  })
  return button
}

function card(question: string, state: {
  progress: string | null
  text: string
  sources: AnswerSource[]
  answer: LiveAnswer | null
  error: { code: string; message: string } | null
}): HTMLElement {
  const box = element('article', 'live-card')
  const head = element('div', 'live-question')
  const mark = icon('question', 14)
  mark.classList.add('live-question-mark')
  head.append(mark, element('span', '', question.length > 0 ? question : 'Buscando la última pregunta…'))
  box.append(head)

  const streaming = state.answer === null && state.error === null
  if (streaming && state.progress !== null) {
    const line = element('div', 'live-progress')
    const spin = icon('spinner', 12)
    spin.classList.add('live-spin')
    line.append(spin, element('span', 'live-progress-path', state.progress))
    box.append(line)
  } else if (streaming && state.text.length === 0) {
    const line = element('div', 'live-progress')
    const spin = icon('spinner', 12)
    spin.classList.add('live-spin')
    line.append(spin, element('span', '', 'Pensando'))
    box.append(line)
  }

  if (state.error !== null) {
    const failure = element('div', 'live-missing live-missing--error')
    failure.append(icon('warning', 14))
    const words = element('div', 'live-missing-text')
    words.append(element('span', 'live-missing-title', 'No pude responder'), element('span', '', state.error.message))
    failure.append(words)
    box.append(failure)
    return box
  }

  const found = state.answer?.found ?? true
  if (!found && state.answer !== null) {
    const missing = element('div', 'live-missing')
    missing.append(icon('warning', 14))
    const words = element('div', 'live-missing-text')
    words.append(element('span', 'live-missing-title', 'No está documentado'))
    if (state.answer.answer.trim().length > 0) words.append(markdown(state.answer.answer, false))
    missing.append(words)
    box.append(missing)
  } else if (state.text.length > 0 || state.answer !== null) {
    box.append(markdown(state.answer?.answer ?? state.text, streaming))
  }

  const sources = state.answer?.sources ?? state.sources
  if (sources.length > 0 || (!found && state.answer !== null)) {
    const row = element('div', found ? 'live-sources' : 'live-sources live-sources--plain')
    for (const source of sources) row.append(sourceChip(source))
    if (!found && state.answer !== null) row.append(element('span', 'spacer'), backlogButton(state.answer))
    box.append(row)
  }
  return box
}

function collapsed(answer: LiveAnswer): HTMLElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'live-earlier'
  const count = answer.sources.length
  button.append(
    element('span', 'live-stamp', askedClock(answer)),
    element('span', 'live-earlier-question', answer.question),
    element(
      'span',
      answer.found ? 'live-earlier-count' : 'live-earlier-count live-earlier-count--missing',
      answer.found ? `${count} ${count === 1 ? 'fuente' : 'fuentes'}` : 'sin fuente',
    ),
  )
  button.addEventListener('click', () => {
    expanded = answer.id
    current = null
    paint()
  })
  return button
}

function hintCard(): HTMLElement {
  const box = element('div', 'live-hint')
  box.append(icon('keyboard', 14))
  const words = element('div', 'live-hint-text')
  words.append(element('span', 'live-hint-title', view.active === null ? 'Sin reunión en curso' : 'Sin preguntas todavía'))
  const where =
    view.project === null
      ? 'Se busca en las páginas de bita y en los repos del proyecto.'
      : repoCount === null
        ? `Se busca en las páginas de ${view.project} y en sus repos.`
        : `Se busca en las páginas de ${view.project} y en ${repoCount === 1 ? 'su repo' : `sus ${repoCount} repos`}.`
  words.append(
    element(
      'span',
      'live-hint-note',
      view.active === null
        ? 'Cuando recap empiece a grabar, aquí aparece la transcripción en vivo.'
        : `Cuando te pregunten algo, pulsa el atajo. ${where}`,
    ),
  )
  box.append(words)
  return box
}

function answersPanel(): HTMLElement {
  const list = element('main', 'live-answers')
  const doneId = current?.done?.id ?? null
  const shownId = current === null ? (expanded ?? view.answers.at(-1)?.id ?? null) : doneId
  if (current !== null) {
    list.append(
      card(current.question, {
        progress: current.progress,
        text: current.text,
        sources: current.sources,
        answer: current.done,
        error: current.error,
      }),
    )
  } else {
    const shown = view.answers.find((answer) => answer.id === shownId)
    if (shown !== undefined) {
      list.append(card(shown.question, { progress: null, text: shown.answer, sources: shown.sources, answer: shown, error: null }))
    }
  }
  const earlier = view.answers.filter((answer) => answer.id !== shownId).reverse()
  if (earlier.length > 0) {
    const label = element('div', 'live-label live-label--rule')
    label.append(element('span', '', 'ANTES EN ESTA REUNIÓN'), element('span', 'live-rule'))
    list.append(label)
    for (const answer of earlier) list.append(collapsed(answer))
  }
  return list
}

function askBox(): HTMLElement {
  const foot = element('footer', 'live-foot')
  const form = document.createElement('form')
  form.className = 'live-ask'
  const label = element('label', 'visually-hidden', 'Pregunta')
  label.setAttribute('for', 'live-question')
  const input = document.createElement('input')
  input.id = 'live-question'
  input.type = 'text'
  input.placeholder = 'Escribe una pregunta…'
  input.autocomplete = 'off'
  input.spellcheck = false
  input.value = draft
  input.disabled = view.active === null
  input.addEventListener('input', () => {
    draft = input.value
  })
  const send = document.createElement('button')
  send.type = 'submit'
  send.className = 'live-send'
  send.setAttribute('aria-label', 'Preguntar')
  send.disabled = view.active === null
  send.append(icon('send', 14))
  form.append(label, input, send)
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const question = draft.trim()
    if (question.length === 0) return
    draft = ''
    ask(question)
  })
  const hint = element('div', 'live-shortcut')
  hint.append(element('span', 'live-kbd', shortcutLabel(view.shortcut)), element('span', '', 'responde lo último que se preguntó'))
  if (notice !== null) hint.append(element('span', 'spacer'), element('span', 'live-notice', notice))
  foot.append(form, hint)
  return foot
}

function ask(question: string | null): void {
  void liveAsk(question)
    .then((askId) => {
      if (current === null || current.askId < askId) start(askId, question ?? '')
    })
    .catch((error: unknown) => {
      const problem = describeProblem(error)
      current = { askId: 0, question: question ?? '', progress: null, text: '', sources: [], done: null, error: { code: 'FAILED', message: problem.message } }
      paint()
    })
}

function start(askId: number, question: string): void {
  current = { askId, question, progress: null, text: '', sources: [], done: null, error: null }
  expanded = null
  paint()
}

function apply(askId: number, event: StreamEvent): void {
  if (askId === 0) {
    if (event.type === 'error') {
      current = { askId: 0, question: '', progress: null, text: '', sources: [], done: null, error: { code: event.code, message: event.message } }
      paint()
    }
    return
  }
  if (current === null || current.askId < askId) start(askId, '')
  if (current === null || current.askId !== askId) return
  if (event.type === 'question') current.question = event.text
  if (event.type === 'progress') current.progress = event.text
  if (event.type === 'delta') {
    current.text += event.text
    current.progress = null
  }
  if (event.type === 'source') current.sources = [...current.sources, event.source]
  if (event.type === 'done') {
    current.done = event.answer
    current.question = event.answer.question
    if (!view.answers.some((answer) => answer.id === event.answer.id)) view.answers = [...view.answers, event.answer]
  }
  if (event.type === 'error') {
    if (event.code === 'CANCELLED') return
    current.error = { code: event.code, message: ERROR_TEXT[event.code] ?? event.message }
  }
  paint()
}

function paint(): void {
  const answers = element('div', 'live-body')
  const idle = current === null && view.answers.length === 0
  if (idle) {
    answers.append(transcriptPanel(true), hintCard())
  } else {
    answers.append(transcriptPanel(false), answersPanel())
  }
  const focused = document.activeElement?.id === 'live-question'
  const caret = focused ? (document.activeElement as HTMLInputElement).selectionStart : null
  const scroller = root.querySelector<HTMLElement>('.live-answers')
  const scroll = scroller?.scrollTop ?? 0
  root.replaceChildren(header(), answers, askBox())
  const next = root.querySelector<HTMLElement>('.live-answers')
  if (next !== null) next.scrollTop = scroll
  if (focused) {
    const input = root.querySelector<HTMLInputElement>('#live-question')
    input?.focus()
    if (input !== null && caret !== null) input.setSelectionRange(caret, caret)
  }
}

async function loadSources(): Promise<void> {
  const project = view.project
  if (project === null || project === sourcesFor) return
  sourcesFor = project
  try {
    const sources = await liveSources(project)
    repoCount = sources === null ? null : sources.repos.filter((repo) => repo.exists).length
  } catch {
    repoCount = null
  }
  paint()
}

async function reload(): Promise<void> {
  const previous = view.active?.meetingId ?? null
  try {
    view = await liveState()
  } catch {
    return
  }
  if ((view.active?.meetingId ?? null) !== previous) {
    current = null
    expanded = null
    backlogged = new Set()
  }
  paint()
  void loadSources()
}

function tick(): void {
  const clock = root.querySelector<HTMLElement>('[data-clock="meeting"]')
  if (clock !== null) clock.textContent = elapsedLabel()
  const delay = root.querySelector<HTMLElement>('.live-delay')
  if (delay !== null) delay.textContent = delayLabel() ?? ''
}

function boot(): void {
  onLiveAnswer(({ askId, event }) => apply(askId, event))
  onLiveState(() => {
    void reload()
  })
  onLiveTranscript((update) => {
    if (view.active?.meetingId !== update.meetingId) return
    view.transcript = update.transcript
    paint()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') void liveHide()
  })
  window.setInterval(tick, 1000)
  paint()
  void reload()
}

boot()
