import type { DocSection, NoteDocument, Problem } from '../bita.ts'
import { element, icon } from '../dom.ts'
import { renderMarkdown } from './markdown.ts'
import { FALLBACK_SECTIONS, anchorOf, placeholderSections } from './sections.ts'

export interface ReaderHandlers {
  onPrev: () => void
  onNext: () => void
  onCopy: (text: string) => void
  onOpenDocument: (relPath: string) => void
  onOpenExternal: (url: string) => void
  onHit: (delta: number) => void
}

export interface ReaderState {
  document: NoteDocument | null
  sections: readonly string[]
  query: string
  hit: number
  hitCount: number
  failure: Problem | null
  loading: boolean
  canPrev: boolean
  canNext: boolean
}

export function renderReader(host: HTMLElement, state: ReaderState, handlers: ReaderHandlers): void {
  if (state.failure !== null) {
    host.replaceChildren(bar(state, handlers), failure(state.failure))
    return
  }

  if (state.loading) {
    host.replaceChildren(bar(state, handlers), element('p', 'placeholder', 'Leyendo…'))
    return
  }

  if (state.document === null) {
    host.replaceChildren(bar(state, handlers), welcome())
    return
  }

  const parts: HTMLElement[] = [bar(state, handlers)]
  parts.push(header(state.document))
  parts.push(body(state, handlers))
  parts.push(footer(state, handlers))
  host.replaceChildren(...parts)
}

function bar(state: ReaderState, handlers: ReaderHandlers): HTMLElement {
  const row = element('div', 'reader-bar')
  row.setAttribute('data-tauri-drag-region', '')

  const crumb = element('span', 'reader-crumb')
  if (state.document !== null) {
    crumb.textContent = `${state.document.projectName ?? 'Sin proyecto'} · ${spanish(state.document.localDay)}`
  }
  row.append(crumb)

  if (state.query.trim().length > 0 && state.hitCount > 0) {
    const nav = element('span', 'hit-nav')
    nav.append(element('span', 'hit-count', `${state.hit + 1} / ${state.hitCount}`))
    nav.append(iconAction('up', 'Coincidencia anterior', () => handlers.onHit(-1)))
    nav.append(iconAction('down', 'Coincidencia siguiente', () => handlers.onHit(1)))
    row.append(nav)
  }

  row.append(iconAction('prev', 'Nota anterior', handlers.onPrev, !state.canPrev))
  row.append(iconAction('next', 'Nota siguiente', handlers.onNext, !state.canNext))
  return row
}

function iconAction(
  name: 'prev' | 'next' | 'up' | 'down',
  label: string,
  onClick: () => void,
  disabled = false,
): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'icon-button reader-step'
  button.setAttribute('aria-label', label)
  button.disabled = disabled
  button.append(icon(name, 14))
  button.addEventListener('click', onClick)
  return button
}

function header(entry: NoteDocument): HTMLElement {
  const head = element('div', 'doc-header')
  const title = element('h1', 'doc-title', entry.doc?.docTitle || entry.title || 'Sin título')
  title.tabIndex = -1
  head.append(title)

  const meta = element('div', 'doc-meta')
  meta.append(element('span', 'tag', entry.durationHuman))
  meta.append(element('span', 'doc-when', `${clockOf(entry.startLocal)} · ${entry.localDay}`))

  if (entry.issueKey) meta.append(element('span', 'tag tag--jira', entry.issueKey))
  else meta.append(element('span', 'pill pill--empty', 'sin Jira'))

  if (entry.doc?.branch) meta.append(element('span', 'pill', entry.doc.branch))
  if (entry.doc?.repoSlug) {
    meta.append(element('span', 'doc-repo', entry.doc.repoSlug.split('/').slice(-2).join('/')))
  }
  if (entry.doc?.file.status === 'changed') {
    meta.append(element('span', 'pill pill--warn', 'editado fuera de bita'))
  }
  head.append(meta)
  return head
}

function body(state: ReaderState, handlers: ReaderHandlers): HTMLElement {
  const wrap = element('div', 'doc-body')
  const article = element('article', 'article')
  const entry = state.document

  if (entry?.doc === null || entry?.doc === undefined) {
    article.append(withoutDocument(entry, handlers))
    wrap.append(article)
    return wrap
  }

  if (entry.doc.markdown === null) {
    article.append(gone(entry.doc.path))
    wrap.append(article)
    return wrap
  }

  const sections = entry.doc.sections ?? placeholderSections(state.sections)
  const bodies = splitSections(entry.doc.markdown)

  for (const section of sections) {
    if (section.state === 'absent') continue
    article.append(sectionBlock(section, bodies.get(section.heading) ?? '', state, handlers))
  }

  wrap.append(article, toc(sections, state))
  return wrap
}

function sectionBlock(
  section: DocSection,
  markdown: string,
  state: ReaderState,
  handlers: ReaderHandlers,
): HTMLElement {
  const block = element('section', 'doc-section')
  block.id = anchorOf(section.heading)
  block.dataset['heading'] = section.heading

  block.append(element('h2', 'doc-section-title', section.heading))

  if (section.state === 'empty' || markdown.trim().length === 0) {
    block.classList.add('doc-section--empty')
    block.append(element('p', 'doc-section-blank', 'Sin escribir todavía'))
    return block
  }

  const rendered = renderMarkdown(markdown, {
    ...(state.query.trim().length > 0 ? { highlight: state.query.trim() } : {}),
    onLink: handlers.onOpenExternal,
  })
  block.append(rendered)
  return block
}

function toc(sections: DocSection[], state: ReaderState): HTMLElement {
  const nav = element('nav', 'toc')
  nav.setAttribute('aria-label', 'Secciones')
  nav.append(element('div', 'toc-title', 'Secciones'))

  const list = element('ul', 'toc-list')
  for (const section of sections) {
    const item = element('li', `toc-item toc-item--${section.state}`)
    item.dataset['heading'] = section.heading
    const dot = element('span', 'toc-dot')
    if (section.state === 'absent') {
      item.append(dot, element('span', 'toc-label', section.heading))
      list.append(item)
      continue
    }
    const link = document.createElement('a')
    link.href = `#${anchorOf(section.heading)}`
    link.className = 'toc-link'
    link.append(dot, element('span', 'toc-label', section.heading))
    item.append(link)
    list.append(item)
  }
  nav.append(list)

  const written = sections.filter((section) => section.state === 'written').length
  const total = sections.filter((section) => section.canonical).length || state.sections.length
  const tally = element('div', 'toc-tally')
  tally.append(element('div', 'toc-tally-label', 'Escritas'))
  const track = element('div', 'meter-track')
  const fill = element('div', 'meter-fill')
  fill.style.width = `${total === 0 ? 0 : Math.round((written / total) * 100)}%`
  track.append(fill)
  tally.append(track, element('div', 'toc-tally-count', `${written} de ${total}`))
  nav.append(tally)

  return nav
}

function withoutDocument(entry: NoteDocument | null, handlers: ReaderHandlers): HTMLElement {
  const box = element('div', 'no-doc')
  const head = element('div', 'no-doc-head')
  head.append(icon('doc', 16))
  head.append(element('span', 'no-doc-title', 'Esta entrada no tiene nota'))
  box.append(head)
  box.append(
    element(
      'p',
      'no-doc-note',
      'Se midió el tiempo pero nunca se escribió el documento. Las notas se escriben desde el CLI mientras trabajas: esta ventana solo lee.',
    ),
  )

  if (entry !== null) {
    const command = `bita note path ${entry.entryId} --create`
    box.append(element('div', 'section-label', 'Cómo nace'))
    const code = element('pre', 'install-log')
    code.textContent = command
    box.append(code)

    const copy = document.createElement('button')
    copy.type = 'button'
    copy.className = 'ghost-button'
    copy.textContent = 'Copiar el comando'
    copy.addEventListener('click', () => {
      handlers.onCopy(command)
    })
    box.append(copy)
  }
  return box
}

function gone(path: string): HTMLElement {
  const box = element('div', 'no-doc')
  box.append(element('span', 'no-doc-title', 'El archivo ya no está'))
  box.append(
    element('p', 'no-doc-note', 'La base lo tiene registrado, pero en el disco no hay nada en esa ruta.'),
  )
  const code = element('pre', 'install-log')
  code.textContent = path
  box.append(code)
  return box
}

function welcome(): HTMLElement {
  const wrap = element('div', 'reader-welcome')
  const empty = element('div', 'empty')
  empty.append(element('div', 'empty-title', 'Elige una nota'))
  empty.append(
    element('div', 'empty-note', 'A la izquierda están los proyectos. Cada entrada con nota se abre aquí.'),
  )
  wrap.append(empty)
  return wrap
}

function failure(problem: Problem): HTMLElement {
  const box = element('div', 'problem')
  box.append(element('div', 'problem-message', problem.message))
  if (problem.hint) box.append(element('div', 'problem-hint', problem.hint))
  return box
}

function footer(state: ReaderState, handlers: ReaderHandlers): HTMLElement {
  const bar = element('div', 'reader-foot')
  const doc = state.document?.doc ?? null
  bar.append(element('span', 'doc-path', doc?.relPath ?? ''))

  if (doc === null) return bar

  const copy = document.createElement('button')
  copy.type = 'button'
  copy.className = 'ghost-button'
  copy.textContent = 'Copiar markdown'
  copy.disabled = doc.markdown === null
  copy.addEventListener('click', () => {
    if (doc.markdown !== null) handlers.onCopy(doc.markdown)
  })

  const open = document.createElement('button')
  open.type = 'button'
  open.className = 'ghost-button'
  open.textContent = 'Abrir en el editor'
  open.addEventListener('click', () => {
    handlers.onOpenDocument(doc.relPath)
  })

  bar.append(copy, open)
  return bar
}

export function splitSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>()
  const lines = markdown.split('\n')
  let heading: string | null = null
  let body: string[] = []

  const flush = (): void => {
    if (heading !== null && !sections.has(heading)) sections.set(heading, body.join('\n').trim())
    body = []
  }

  for (const line of lines) {
    const found = /^##\s+(.*\S)\s*$/.exec(line)
    if (found?.[1] !== undefined) {
      flush()
      heading = found[1]
      continue
    }
    if (heading !== null) body.push(line)
  }
  flush()
  return sections
}

function clockOf(startLocal: string): string {
  return startLocal.slice(11, 16)
}

function spanish(localDay: string): string {
  const months = [
    'ene',
    'feb',
    'mar',
    'abr',
    'may',
    'jun',
    'jul',
    'ago',
    'sep',
    'oct',
    'nov',
    'dic',
  ]
  const [year, month, day] = localDay.split('-')
  return `${Number(day)} ${months[Number(month) - 1] ?? ''} ${year ?? ''}`.trim()
}

export { FALLBACK_SECTIONS }
