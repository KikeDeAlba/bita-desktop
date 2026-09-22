import { element } from '../dom.ts'

export interface RenderOptions {
  highlight?: string
  onLink?: (url: string) => void
}

const FENCE = /^(?:```|~~~)/
const HEADING = /^(#{1,6})\s+(.*\S)\s*$/
const BULLET = /^(\s*)[-*]\s+(.*)$/
const NUMBERED = /^(\s*)\d+[.)]\s+(.*)$/
const QUOTE = /^>\s?(.*)$/
const RULE = /^(?:-{3,}|\*{3,}|_{3,})\s*$/
const TABLE = /^\s*\|.*\|\s*$/
const ALIGN = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/
const CODE_SPAN = /`([^`]+)`/
const LINK = /\[([^\]\n]*)\]\(([^)\s]+)\)/
const BARE_URL = /https?:\/\/[^\s<>()]+[^\s<>().,;:!?]/
const BOLD = /\*\*([^*\n]+)\*\*/
const ITALIC = /(?:\*([^*\n]+)\*|_([^_\n]+)_)/

function foldChar(char: string): string {
  const decomposed = char.normalize('NFD')
  const first = decomposed.codePointAt(0)
  if (first === undefined) return char

  const lowered = String.fromCodePoint(first).toLowerCase()
  if (lowered.length === char.length) return lowered

  const plain = char.toLowerCase()
  return plain.length === char.length ? plain : char
}

export function foldForSearch(text: string): string {
  let folded = ''
  for (const char of text) folded += foldChar(char)
  return folded
}

class Emitter {
  private hits = 0
  private readonly needle: string

  constructor(needle: string) {
    this.needle = needle
  }

  text(parent: Node, value: string): void {
    if (value.length === 0) return
    if (this.needle.length === 0) {
      parent.appendChild(document.createTextNode(value))
      return
    }

    const haystack = foldForSearch(value)
    let cursor = 0

    for (
      let at = haystack.indexOf(this.needle);
      at !== -1;
      at = haystack.indexOf(this.needle, at + this.needle.length)
    ) {
      if (at > cursor) parent.appendChild(document.createTextNode(value.slice(cursor, at)))
      const mark = element('mark', 'hit')
      mark.dataset['hit'] = String(this.hits)
      mark.textContent = value.slice(at, at + this.needle.length)
      parent.appendChild(mark)
      this.hits += 1
      cursor = at + this.needle.length
    }

    if (cursor < value.length) parent.appendChild(document.createTextNode(value.slice(cursor)))
  }

  plain(parent: Node, value: string): void {
    parent.appendChild(document.createTextNode(value))
  }
}

export function renderMarkdown(source: string, options: RenderOptions = {}): DocumentFragment {
  const fragment = document.createDocumentFragment()
  const emitter = new Emitter(options.highlight ? foldForSearch(options.highlight) : '')
  const lines = source.split('\n')
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''

    if (line.trim().length === 0) {
      index += 1
      continue
    }

    if (FENCE.test(line)) {
      const body: string[] = []
      index += 1
      while (index < lines.length && !FENCE.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '')
        index += 1
      }
      index += 1
      const pre = element('pre', 'md-code')
      const code = element('code')
      emitter.plain(code, body.join('\n'))
      pre.appendChild(code)
      fragment.appendChild(pre)
      continue
    }

    const heading = HEADING.exec(line)
    if (heading?.[2] !== undefined) {
      const depth = (heading[1] ?? '###').length
      const node = element(depth >= 3 ? 'h3' : 'h4', 'md-heading')
      inline(node, heading[2], emitter, options)
      fragment.appendChild(node)
      index += 1
      continue
    }

    if (RULE.test(line)) {
      fragment.appendChild(element('hr', 'md-rule'))
      index += 1
      continue
    }

    if (TABLE.test(line)) {
      const body: string[] = []
      while (index < lines.length && TABLE.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '')
        index += 1
      }

      const table = buildTable(body, emitter, options)
      if (table !== null) {
        fragment.appendChild(table)
        continue
      }

      const pre = element('pre', 'md-code md-table-raw')
      const code = element('code')
      emitter.plain(code, body.join('\n'))
      pre.appendChild(code)
      fragment.appendChild(pre)
      continue
    }

    if (QUOTE.test(line)) {
      const body: string[] = []
      while (index < lines.length && QUOTE.test(lines[index] ?? '')) {
        body.push(QUOTE.exec(lines[index] ?? '')?.[1] ?? '')
        index += 1
      }
      const quote = element('blockquote', 'md-quote')
      inline(quote, body.join(' '), emitter, options)
      fragment.appendChild(quote)
      continue
    }

    if (BULLET.test(line) || NUMBERED.test(line)) {
      const ordered = NUMBERED.test(line) && !BULLET.test(line)
      const consumed = list(lines, index, ordered, emitter, options)
      fragment.appendChild(consumed.node)
      index = consumed.index
      continue
    }

    const body: string[] = []
    while (index < lines.length) {
      const next = lines[index] ?? ''
      if (next.trim().length === 0 || startsBlock(next)) break
      body.push(next)
      index += 1
    }
    const paragraph = element('p', 'md-paragraph')
    inline(paragraph, body.join(' '), emitter, options)
    fragment.appendChild(paragraph)
  }

  return fragment
}

function startsBlock(line: string): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    TABLE.test(line) ||
    QUOTE.test(line) ||
    BULLET.test(line) ||
    NUMBERED.test(line)
  )
}

function list(
  lines: string[],
  start: number,
  ordered: boolean,
  emitter: Emitter,
  options: RenderOptions,
): { node: HTMLElement; index: number } {
  const node = element(ordered ? 'ol' : 'ul', 'md-list')
  let index = start
  let current: HTMLElement | null = null

  while (index < lines.length) {
    const line = lines[index] ?? ''
    const match = BULLET.exec(line) ?? NUMBERED.exec(line)
    if (!match) {
      if (line.trim().length === 0) break
      if (startsBlock(line)) break
      if (current) {
        inline(current, ` ${line.trim()}`, emitter, options)
        index += 1
        continue
      }
      break
    }

    const indent = (match[1] ?? '').length
    const text = match[2] ?? ''

    if (indent >= 2 && current) {
      const nested = current.querySelector('ul.md-list') ?? element('ul', 'md-list')
      const item = element('li', 'md-item')
      inline(item, text, emitter, options)
      nested.appendChild(item)
      if (!current.contains(nested)) current.appendChild(nested)
      index += 1
      continue
    }

    current = element('li', 'md-item')
    inline(current, text, emitter, options)
    node.appendChild(current)
    index += 1
  }

  return { node, index }
}

export function splitRow(line: string): string[] {
  const trimmed = line.trim()
  const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let cell = ''
  let inCode = false

  for (let at = 0; at < inner.length; at += 1) {
    const char = inner[at] as string
    if (char === '\\' && inner[at + 1] === '|') {
      cell += '|'
      at += 1
      continue
    }
    if (char === '`') inCode = !inCode
    if (char === '|' && !inCode) {
      cells.push(cell.trim())
      cell = ''
      continue
    }
    cell += char
  }
  cells.push(cell.trim())
  return cells
}

function alignmentsOf(line: string): (string | null)[] {
  return splitRow(line).map((cell) => {
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    if (left) return 'left'
    return null
  })
}

function buildTable(rows: string[], emitter: Emitter, options: RenderOptions): HTMLElement | null {
  const headRow = rows[0]
  const alignRow = rows[1]
  if (headRow === undefined || alignRow === undefined) return null
  if (!ALIGN.test(alignRow)) return null

  const headings = splitRow(headRow)
  const aligns = alignmentsOf(alignRow)
  if (headings.length === 0 || aligns.length !== headings.length) return null

  const scroll = element('div', 'md-table-scroll')
  const table = element('table', 'md-table')

  const thead = element('thead')
  const headTr = element('tr')
  for (const [at, heading] of headings.entries()) {
    const th = element('th')
    th.setAttribute('scope', 'col')
    const align = aligns[at]
    if (align) th.style.textAlign = align
    inline(th, heading, emitter, options)
    headTr.appendChild(th)
  }
  thead.appendChild(headTr)
  table.appendChild(thead)

  const tbody = element('tbody')
  for (const raw of rows.slice(2)) {
    const cells = splitRow(raw)
    const tr = element('tr')
    for (let at = 0; at < headings.length; at += 1) {
      const td = element('td')
      const align = aligns[at]
      if (align) td.style.textAlign = align
      inline(td, cells[at] ?? '', emitter, options)
      tr.appendChild(td)
    }
    tbody.appendChild(tr)
  }
  table.appendChild(tbody)

  scroll.appendChild(table)
  return scroll
}

function inline(parent: Node, text: string, emitter: Emitter, options: RenderOptions): void {
  let rest = text

  while (rest.length > 0) {
    const code = CODE_SPAN.exec(rest)
    const link = LINK.exec(rest)
    const url = BARE_URL.exec(rest)
    const bold = BOLD.exec(rest)
    const italic = ITALIC.exec(rest)

    const next = [code, link, url, bold, italic]
      .filter((found): found is RegExpExecArray => found !== null)
      .sort((left, right) => left.index - right.index)[0]

    if (!next) {
      emitter.text(parent, rest)
      return
    }

    if (next.index > 0) emitter.text(parent, rest.slice(0, next.index))

    if (next === code) {
      const node = element('code', 'md-inline-code')
      emitter.plain(node, next[1] ?? '')
      parent.appendChild(node)
    } else if (next === link) {
      parent.appendChild(anchor(next[2] ?? '', next[1] ?? '', emitter, options))
    } else if (next === url) {
      parent.appendChild(anchor(next[0], next[0], emitter, options))
    } else if (next === bold) {
      const node = element('strong')
      inline(node, next[1] ?? '', emitter, options)
      parent.appendChild(node)
    } else {
      const node = element('em')
      inline(node, next[1] ?? next[2] ?? '', emitter, options)
      parent.appendChild(node)
    }

    rest = rest.slice(next.index + next[0].length)
  }
}

function anchor(url: string, label: string, emitter: Emitter, options: RenderOptions): HTMLElement {
  const node = element('a', 'md-link') as HTMLAnchorElement
  node.href = url
  emitter.text(node, label)
  node.addEventListener('click', (event) => {
    event.preventDefault()
    options.onLink?.(url)
  })
  return node
}

export function countHits(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('mark.hit')]
}
