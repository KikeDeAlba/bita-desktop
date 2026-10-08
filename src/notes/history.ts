import { describeProblem, pageDiff, pageHistory, pageRestore, type PageDiff, type PageHistory, type Problem, type Revision } from '../bita.ts'
import { element, icon } from '../dom.ts'
import { renderDiff } from './diff.ts'
import { confirmDialog, openModal } from './media-dialogs.ts'
import './proposals.css'

const SOURCE_LABEL: Record<string, string> = {
  manual: 'Edición manual',
  meeting: 'Reunión',
  'confluence-pull': 'Sync de Confluence',
  restore: 'Restauración',
  note: 'Nota del cronómetro',
  import: 'Importación inicial',
  unknown: 'Cambio',
}

type DiffLoad = { state: 'loading' } | { state: 'ready'; diff: PageDiff } | { state: 'failed'; problem: Problem }

export interface HistoryTarget {
  pageId: number
  title: string
  projectName: string | null
}

export function sourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? SOURCE_LABEL['unknown'] ?? 'Cambio'
}

function when(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(0, 16)
  const weekday = date.toLocaleDateString('es-MX', { weekday: 'short' }).replace('.', '')
  const day = date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }).replace('.', '')
  const time = date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${weekday} ${day}, ${time}`
}

function note(revision: Revision): string {
  if (revision.reason !== null && revision.reason.trim().length > 0) return revision.reason
  if (revision.source === 'confluence-pull') return 'Pull: cambios hechos en Confluence'
  return revision.subject
}

export function openHistoryDialog(target: HistoryTarget, onRestored: () => void): void {
  const modal = openModal('history-title', 'wide')
  modal.dialog.classList.add('history-dialog')
  let history: PageHistory | null = null
  let failure: Problem | null = null
  let open: string | null = null
  let restoring: string | null = null
  const diffs = new Map<string, DiffLoad>()

  const loadDiff = (sha: string): void => {
    if (diffs.has(sha)) return
    diffs.set(sha, { state: 'loading' })
    void pageDiff(target.pageId, sha)
      .then((diff) => diffs.set(sha, { state: 'ready', diff }))
      .catch((error: unknown) => diffs.set(sha, { state: 'failed', problem: describeProblem(error) }))
      .finally(paint)
  }

  const restore = (revision: Revision): void => {
    void confirmDialog({
      title: '¿Restaurar esta versión?',
      body: `La página vuelve a como estaba el ${when(revision.date)}. La versión actual queda en el historial.`,
      confirm: 'Restaurar',
    }).then((yes) => {
      if (!yes) return
      restoring = revision.sha
      paint()
      void pageRestore(target.pageId, revision.sha)
        .then(() => {
          restoring = null
          onRestored()
          modal.close()
        })
        .catch((error: unknown) => {
          restoring = null
          failure = describeProblem(error)
          paint()
        })
    })
  }

  const entry = (revision: Revision, index: number, total: number): HTMLElement => {
    const row = element('div', 'history-row')
    const rail = element('div', 'history-rail')
    rail.append(element('span', index === 0 ? 'history-dot history-dot--now' : 'history-dot'))
    if (index < total - 1) rail.append(element('span', 'history-line'))
    const expanded = open === revision.sha
    const body = element('div', expanded ? 'history-body history-body--open' : 'history-body')
    const top = element('div', 'history-top')
    top.append(
      element('span', index === 0 ? 'history-name history-name--now' : 'history-name', index === 0 ? 'Actual' : sourceLabel(revision.source)),
      element('span', 'history-when', when(revision.date)),
      element('span', 'spacer'),
    )
    const view = document.createElement('button')
    view.type = 'button'
    view.className = 'history-button'
    view.textContent = expanded ? 'Ocultar' : 'Ver'
    view.addEventListener('click', () => {
      open = expanded ? null : revision.sha
      if (open !== null) loadDiff(revision.sha)
      paint()
    })
    top.append(view)
    if (index > 0) {
      const back = document.createElement('button')
      back.type = 'button'
      back.className = 'history-button history-button--restore'
      back.disabled = restoring !== null
      back.append(icon('history', 12), element('span', '', restoring === revision.sha ? 'Restaurando…' : 'Restaurar'))
      back.addEventListener('click', () => restore(revision))
      top.append(back)
    }
    body.append(top)
    const meta = element('div', 'history-meta')
    if (index === 0 || revision.source === 'meeting') {
      meta.append(element('span', `history-source history-source--${revision.source}`, sourceLabel(revision.source)))
    }
    meta.append(element('span', 'history-note', note(revision)))
    body.append(meta)
    if (expanded) {
      const load = diffs.get(revision.sha)
      if (load === undefined || load.state === 'loading') body.append(element('p', 'prop-note', 'Leyendo el cambio…'))
      else if (load.state === 'failed') body.append(element('p', 'prop-note', load.problem.message))
      else body.append(renderDiff(load.diff.hunks))
    }
    row.append(rail, body)
    return row
  }

  const paint = (): void => {
    const head = element('div', 'history-head')
    const words = element('div', 'history-words')
    const title = element('h2', 'history-title', `Historial · ${target.title}`)
    title.id = 'history-title'
    const count = history?.revisions.length ?? null
    words.append(
      title,
      element(
        'span',
        'history-sub',
        `${target.projectName ?? 'Sin proyecto'}${count === null ? '' : ` · ${count} ${count === 1 ? 'versión guardada' : 'versiones guardadas'}`}`,
      ),
    )
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'icon-button'
    close.setAttribute('aria-label', 'Cerrar')
    close.append(icon('close', 14))
    close.addEventListener('click', modal.close)
    head.append(words, close)

    const list = element('div', 'history-list')
    if (failure !== null) {
      const box = element('div', 'problem')
      box.append(element('p', 'problem-message', failure.message))
      if (failure.hint !== null) box.append(element('code', 'problem-hint', failure.hint))
      list.append(box)
    }
    if (history === null && failure === null) list.append(element('p', 'prop-note', 'Leyendo el historial…'))
    if (history !== null) {
      if (history.revisions.length === 0) list.append(element('p', 'prop-note', 'Esta página todavía no tiene versiones guardadas.'))
      const total = history.revisions.length
      history.revisions.forEach((revision, index) => list.append(entry(revision, index, total)))
    }
    const foot = element('p', 'history-foot', 'Restaurar guarda primero la versión actual, así que también se puede deshacer.')
    modal.dialog.replaceChildren(head, list, foot)
  }

  paint()
  void pageHistory(target.pageId)
    .then((value) => {
      history = value
    })
    .catch((error: unknown) => {
      failure = describeProblem(error)
    })
    .finally(paint)
}
