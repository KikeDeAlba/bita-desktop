import type { Hunk } from '../bita.ts'
import { element } from '../dom.ts'

const MARK: Record<string, string> = { add: '+', del: '−' }

export interface DiffCounts {
  added: number
  removed: number
}

export function diffCounts(hunks: Hunk[]): DiffCounts {
  let added = 0
  let removed = 0
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.kind === 'add') added += 1
      if (line.kind === 'del') removed += 1
    }
  }
  return { added, removed }
}

export function diffCountsLabel(counts: DiffCounts): HTMLElement {
  const wrap = element('span', 'diff-counts')
  wrap.append(element('span', 'diff-count diff-count--add', `+${counts.added}`), element('span', 'diff-count diff-count--del', `−${counts.removed}`))
  return wrap
}

export function renderDiff(hunks: Hunk[]): HTMLElement {
  const box = element('div', 'diff')
  hunks.forEach((hunk, index) => {
    if (index > 0) box.append(element('div', 'diff-gap', '⋯'))
    for (const line of hunk.lines) {
      const kind = line.kind === 'add' || line.kind === 'del' ? line.kind : 'context'
      const row = element('div', `diff-row diff-row--${kind}`)
      row.append(element('span', 'diff-mark', MARK[kind] ?? ' '), element('span', 'diff-text', line.text.length === 0 ? ' ' : line.text))
      box.append(row)
    }
  })
  if (hunks.length === 0) box.append(element('div', 'diff-row diff-row--context', 'Sin diferencias.'))
  return box
}
