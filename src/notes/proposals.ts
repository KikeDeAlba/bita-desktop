import {
  confluenceSyncStatus,
  describeProblem,
  docsBranchDiff,
  openSourceFile,
  proposalAccept,
  proposalReject,
  proposalShow,
  type AnswerSource,
  type BranchCommit,
  type LiveAnswer,
  type MeetingView,
  type Problem,
  type Proposal,
} from '../bita.ts'
import { element, icon } from '../dom.ts'
import { diffCounts, diffCountsLabel, renderDiff } from './diff.ts'
import { renderMarkdown } from './markdown.ts'
import './proposals.css'

export interface ProposalHandlers {
  project: string | null
  onSeek: (seconds: number) => void
  onCopy: (text: string) => void
  onLink: (url: string) => void
  onOpenPage: (pageId: number) => void
  onChanged: () => void
}

type DiffLoad = { state: 'loading' } | { state: 'ready'; commit: BranchCommit | null } | { state: 'failed'; problem: Problem }

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente',
  accepted: 'Aceptado',
  rejected: 'Rechazado',
  stale: 'Desactualizado',
}
const CHANNEL_LABEL: Record<string, string> = { mic: 'Sala', system: 'Remotos' }

let meetingKey: string | null = null
let selected: number | null = null
let diffs = new Map<string, DiffLoad>()
let editing: { n: number; text: string; loading: boolean } | null = null
let busy: number | null = null
let failure: string | null = null
const linked = new Map<string, Set<number> | 'loading'>()

let wrap: HTMLElement | null = null
let currentView: MeetingView | null = null
let currentHandlers: ProposalHandlers | null = null

export function pendingProposals(view: MeetingView): number {
  return view.proposals.filter((proposal) => proposal.status === 'pending').length
}

function stamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const seconds = String(total % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`
}

function where(proposal: Proposal): string {
  const page = proposal.pageTitle ?? `Página ${proposal.pageId}`
  return proposal.section === null ? page : `${page} › ${proposal.section}`
}

function statusChip(status: string): HTMLElement {
  return element('span', `prop-status prop-status--${status}`, STATUS_LABEL[status] ?? status)
}

function repaint(): void {
  if (wrap === null || currentView === null || currentHandlers === null) return
  fill(wrap, currentView, currentHandlers)
}

function ensureLinked(project: string | null): void {
  if (project === null || linked.has(project)) return
  linked.set(project, 'loading')
  void confluenceSyncStatus(project)
    .then((mappings) => {
      linked.set(project, new Set(mappings.map((mapping) => mapping.pageId)))
    })
    .catch(() => {
      linked.set(project, new Set())
    })
    .finally(repaint)
}

function isLinked(project: string | null, pageId: number): boolean {
  if (project === null) return false
  const pages = linked.get(project)
  return pages instanceof Set && pages.has(pageId)
}

function ensureDiff(proposal: Proposal): void {
  if (proposal.branch === null || proposal.sha === null) return
  const key = `${proposal.branch}@${proposal.sha}`
  if (diffs.has(key)) return
  diffs.set(key, { state: 'loading' })
  void docsBranchDiff(proposal.branch, proposal.sha)
    .then((diff) => {
      diffs.set(key, { state: 'ready', commit: diff.commits.find((commit) => commit.sha.startsWith(proposal.sha ?? '')) ?? diff.commits[0] ?? null })
    })
    .catch((error: unknown) => {
      diffs.set(key, { state: 'failed', problem: describeProblem(error) })
    })
    .finally(repaint)
}

function listItem(proposal: Proposal, on: boolean): HTMLElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = `prop-item prop-item--${proposal.status}${on ? ' prop-item--on' : ''}`
  button.setAttribute('aria-pressed', String(on))
  const meta = element('span', 'prop-item-meta')
  meta.append(statusChip(proposal.status), element('span', 'prop-item-where', where(proposal)))
  button.append(meta, element('span', 'prop-item-title', proposal.title))
  button.addEventListener('click', () => {
    selected = proposal.n
    editing = null
    failure = null
    repaint()
  })
  return button
}

function quotes(proposal: Proposal, handlers: ProposalHandlers): HTMLElement | null {
  if (proposal.quotes.length === 0) return null
  const block = element('div', 'prop-block')
  block.append(element('span', 'prop-label', 'LO QUE SE DIJO'))
  for (const quote of proposal.quotes) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'prop-quote'
    button.title = 'Escucharlo en la pestaña Reunión'
    const time = element('span', 'prop-quote-time')
    time.append(icon('play', 9), element('span', '', stamp(quote.startMs)))
    const said = element('span', 'prop-quote-text')
    const channel = quote.channel ?? ''
    if (channel.length > 0) said.append(element('b', `prop-who prop-who--${channel}`, CHANNEL_LABEL[channel] ?? channel), ' ')
    said.append(quote.text)
    button.append(time, said)
    button.addEventListener('click', () => handlers.onSeek(quote.startMs / 1000))
    block.append(button)
  }
  return block
}

function change(proposal: Proposal): HTMLElement {
  const block = element('div', 'prop-block')
  const head = element('div', 'prop-label-row')
  head.append(element('span', 'prop-label', 'CAMBIO'), element('span', 'spacer'))
  block.append(head)
  if (proposal.branch === null || proposal.sha === null) {
    block.append(element('p', 'prop-note', 'Esta propuesta no trae su commit.'))
    return block
  }
  const load = diffs.get(`${proposal.branch}@${proposal.sha}`)
  if (load === undefined || load.state === 'loading') {
    block.append(element('p', 'prop-note', 'Leyendo el cambio…'))
    return block
  }
  if (load.state === 'failed') {
    const settled = proposal.status === 'accepted' || proposal.status === 'rejected'
    const box = element('div', 'problem')
    box.append(
      element(
        'p',
        'problem-message',
        settled ? 'La rama de la propuesta ya no está; el cambio aceptado queda en el historial de la página.' : load.problem.message,
      ),
    )
    if (!settled && load.problem.hint !== null) box.append(element('code', 'problem-hint', load.problem.hint))
    block.append(box)
    return block
  }
  const hunks = load.commit?.hunks ?? []
  head.append(diffCountsLabel(diffCounts(hunks)))
  block.append(renderDiff(hunks))
  return block
}

function actionButton(label: string, className: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.textContent = label
  button.disabled = disabled
  button.addEventListener('click', onClick)
  return button
}

function settle(view: MeetingView, handlers: ProposalHandlers, run: () => Promise<Proposal>, n: number): void {
  busy = n
  failure = null
  repaint()
  void run()
    .then((updated) => {
      const index = view.proposals.findIndex((proposal) => proposal.n === updated.n)
      if (index !== -1) view.proposals[index] = { ...view.proposals[index], ...updated }
      if (updated.status === 'stale') failure = 'La página cambió desde la propuesta y no se pudo aplicar. Edítala para proponerla de nuevo.'
      editing = null
      handlers.onChanged()
    })
    .catch((error: unknown) => {
      failure = describeProblem(error).message
    })
    .finally(() => {
      busy = null
      repaint()
    })
}

function startEditing(view: MeetingView, proposal: Proposal): void {
  editing = { n: proposal.n, text: '', loading: true }
  repaint()
  void proposalShow(view.id, proposal.n)
    .then((detail) => {
      if (editing?.n !== proposal.n) return
      editing = { n: proposal.n, text: detail.markdown ?? '', loading: false }
    })
    .catch((error: unknown) => {
      failure = describeProblem(error).message
      editing = null
    })
    .finally(repaint)
}

function editor(view: MeetingView, proposal: Proposal, handlers: ProposalHandlers): HTMLElement {
  const block = element('div', 'prop-block')
  block.append(element('span', 'prop-label', proposal.section === null ? 'TEXTO PROPUESTO' : `TEXTO PROPUESTO PARA «${proposal.section.toUpperCase()}»`))
  const area = document.createElement('textarea')
  area.className = 'prop-editor'
  area.spellcheck = false
  area.disabled = editing?.loading === true
  area.value = editing?.loading === true ? 'Leyendo la propuesta…' : (editing?.text ?? '')
  area.addEventListener('input', () => {
    if (editing !== null) editing.text = area.value
  })
  block.append(area)
  const actions = element('div', 'prop-actions')
  actions.append(
    actionButton('Cancelar', 'prop-button', () => {
      editing = null
      repaint()
    }),
    actionButton(
      'Aceptar con cambios',
      'prop-button prop-button--accept',
      () => {
        const text = editing?.text ?? ''
        settle(view, handlers, () => proposalAccept(view.id, proposal.n, text), proposal.n)
      },
      editing?.loading === true || busy !== null,
    ),
  )
  block.append(actions)
  return block
}

function detail(view: MeetingView, proposal: Proposal, handlers: ProposalHandlers): HTMLElement {
  const pane = element('section', 'prop-detail')
  const head = element('div', 'prop-head')
  const crumb = element('span', 'prop-crumb')
  const page = document.createElement('button')
  page.type = 'button'
  page.className = 'prop-page'
  page.textContent = proposal.pageTitle ?? `Página ${proposal.pageId}`
  page.addEventListener('click', () => handlers.onOpenPage(proposal.pageId))
  crumb.append(page)
  if (proposal.section !== null) crumb.append(' · sección ', element('b', '', proposal.section))
  head.append(crumb, element('span', 'prop-title', proposal.title))
  if (proposal.rationale !== null && proposal.rationale.trim().length > 0) head.append(element('p', 'prop-rationale', proposal.rationale))
  pane.append(head)

  const said = quotes(proposal, handlers)
  if (said !== null) pane.append(said)

  if (editing?.n === proposal.n) pane.append(editor(view, proposal, handlers))
  else pane.append(change(proposal))

  if (isLinked(handlers.project, proposal.pageId) && (proposal.status === 'pending' || proposal.status === 'stale')) {
    const notice = element('div', 'prop-notice')
    notice.append(icon('link', 13), element('span', '', 'Ligada a Confluence. Si la aceptas, se publica en el siguiente sync. La versión actual queda en el historial.'))
    pane.append(notice)
  }

  if (failure !== null) {
    const box = element('div', 'problem')
    box.append(element('p', 'problem-message', failure))
    pane.append(box)
  }

  const open = proposal.status === 'pending' || proposal.status === 'stale'
  if (open && editing?.n !== proposal.n) {
    const working = busy === proposal.n
    const actions = element('div', 'prop-actions')
    actions.append(
      actionButton('Rechazar', 'prop-button', () => settle(view, handlers, () => proposalReject(view.id, proposal.n), proposal.n), working),
      actionButton('Editar antes de aceptar', 'prop-button prop-button--edit', () => startEditing(view, proposal), working),
    )
    if (proposal.status === 'pending') {
      const accept = actionButton(
        working ? 'Aplicando…' : 'Aceptar',
        'prop-button prop-button--accept',
        () => settle(view, handlers, () => proposalAccept(view.id, proposal.n, null), proposal.n),
        working,
      )
      accept.prepend(icon('check', 13))
      actions.append(accept)
    }
    pane.append(actions)
  } else if (!open) {
    pane.append(
      element(
        'p',
        'prop-note',
        proposal.status === 'accepted'
          ? `Aceptado${proposal.appliedSha === null ? '' : ` en ${proposal.appliedSha.slice(0, 7)}`}: ya está en la página.`
          : 'Rechazado: la página quedó como estaba.',
      ),
    )
  }
  return pane
}

function fill(target: HTMLElement, view: MeetingView, handlers: ProposalHandlers): void {
  if (view.proposals.length === 0) {
    target.replaceChildren(element('p', 'doc-section-blank', 'Esta reunión no dejó cambios propuestos.'))
    return
  }
  const order = [...view.proposals].sort((left, right) => {
    const rank = (proposal: Proposal) => (proposal.status === 'pending' ? 0 : proposal.status === 'stale' ? 1 : 2)
    return rank(left) - rank(right) || left.n - right.n
  })
  const chosen = order.find((proposal) => proposal.n === selected) ?? order[0]
  if (chosen === undefined) return
  selected = chosen.n
  ensureDiff(chosen)
  ensureLinked(handlers.project)

  const list = element('nav', 'prop-list')
  list.setAttribute('aria-label', 'Cambios propuestos')
  for (const proposal of order) list.append(listItem(proposal, proposal.n === chosen.n))
  list.append(element('p', 'prop-foot', 'Ideas, dudas y cosas que se corrigieron después no se proponen.'))
  target.replaceChildren(list, detail(view, chosen, handlers))
}

export function renderProposals(view: MeetingView, handlers: ProposalHandlers): HTMLElement {
  if (meetingKey !== view.id) {
    meetingKey = view.id
    selected = null
    diffs = new Map()
    editing = null
    failure = null
  }
  wrap = element('div', 'prop')
  currentView = view
  currentHandlers = handlers
  fill(wrap, view, handlers)
  return wrap
}

function sourceChip(source: AnswerSource, handlers: ProposalHandlers): HTMLElement {
  const kind = source.kind === 'page' || source.kind === 'commit' ? source.kind : 'file'
  const chip = document.createElement('button')
  chip.type = 'button'
  chip.className = `answer-source answer-source--${kind}`
  chip.append(icon(kind === 'page' ? 'doc' : kind === 'commit' ? 'commit' : 'code', 11), element('span', '', source.label))
  if (kind === 'page' && source.pageId !== undefined) {
    const pageId = source.pageId
    chip.addEventListener('click', () => handlers.onOpenPage(pageId))
  } else if (kind === 'file' && source.path !== undefined) {
    const path = source.path
    chip.addEventListener('click', () => {
      void openSourceFile(path).catch(() => undefined)
    })
  } else if (kind === 'commit') {
    chip.addEventListener('click', () => handlers.onCopy(source.sha ?? source.label))
  } else {
    chip.disabled = true
  }
  return chip
}

function answerCard(answer: LiveAnswer, startedAt: string | null, handlers: ProposalHandlers): HTMLElement {
  const card = element('article', answer.found ? 'answer' : 'answer answer--missing')
  const head = element('div', 'answer-head')
  const offset = startedAt === null ? Number.NaN : new Date(answer.askedAt).getTime() - new Date(startedAt).getTime()
  const when = Number.isFinite(offset) && offset >= 0 ? stamp(offset) : answer.askedAt.slice(11, 16)
  const time = document.createElement('button')
  time.type = 'button'
  time.className = 'answer-time'
  time.textContent = when
  time.title = 'Escuchar ese momento'
  time.disabled = !(Number.isFinite(offset) && offset >= 0)
  time.addEventListener('click', () => handlers.onSeek(Math.max(0, offset / 1000 - 15)))
  head.append(time, element('span', 'answer-question', answer.question))
  if (!answer.found) head.append(element('span', 'prop-status prop-status--stale', 'No está documentado'))
  card.append(head)
  const body = element('div', 'answer-body')
  body.append(renderMarkdown(answer.answer, { onCopy: handlers.onCopy, onLink: handlers.onLink }))
  card.append(body)
  if (answer.sources.length > 0) {
    const row = element('div', 'answer-sources')
    for (const source of answer.sources) row.append(sourceChip(source, handlers))
    card.append(row)
  }
  return card
}

export function renderAnswers(view: MeetingView, handlers: ProposalHandlers): HTMLElement {
  const wrapAnswers = element('div', 'doc-body')
  const article = element('article', 'article answers')
  if (view.answers.length === 0) {
    article.append(element('p', 'doc-section-blank', 'En esta reunión no se le preguntó nada al asistente.'))
  } else {
    article.append(
      element(
        'p',
        'answers-lede',
        `${view.answers.length} ${view.answers.length === 1 ? 'respuesta' : 'respuestas'} durante la reunión, con las fuentes que se consultaron.`,
      ),
    )
    for (const answer of view.answers) article.append(answerCard(answer, view.startedAt, handlers))
  }
  wrapAnswers.append(article)
  return wrapAnswers
}
