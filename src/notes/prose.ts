import { element } from '../dom.ts'

const KEY = 'bita.notes.prose-width'
export const PROSE_MIN = 560
export const PROSE_MAX = 1600
export const PROSE_DEFAULT = 960
const STEP = 40

let current = PROSE_DEFAULT
let root: HTMLElement | null = null

export function clampProse(value: number): number {
  if (!Number.isFinite(value)) return PROSE_DEFAULT
  return Math.min(PROSE_MAX, Math.max(PROSE_MIN, Math.round(value / 20) * 20))
}

export function proseValue(width: number): string {
  return width >= PROSE_MAX ? '100%' : `${width}px`
}

export function proseLabel(width: number): string {
  return width >= PROSE_MAX ? 'Todo el ancho' : `${width} px`
}

function persist(): void {
  try {
    if (current === PROSE_DEFAULT) window.localStorage.removeItem(KEY)
    else window.localStorage.setItem(KEY, String(current))
  } catch {
    return
  }
}

function paint(): void {
  root?.style.setProperty('--prose-w', proseValue(current))
  for (const input of document.querySelectorAll<HTMLInputElement>('.prose-width-range')) {
    input.value = String(current)
    input.setAttribute('aria-valuetext', proseLabel(current))
    input.title = `Ancho del texto: ${proseLabel(current)}`
  }
}

export function initProse(host: HTMLElement): void {
  root = host
  try {
    const stored = Number(window.localStorage.getItem(KEY))
    current = stored > 0 ? clampProse(stored) : PROSE_DEFAULT
  } catch {
    current = PROSE_DEFAULT
  }
  paint()
}

export function setProse(width: number): void {
  current = clampProse(width)
  paint()
  persist()
}

export function stepProse(direction: 1 | -1): void {
  setProse(current + direction * STEP)
}

export function proseControl(): HTMLElement {
  const wrap = element('label', 'prose-width')
  const narrow = element('span', 'prose-width-glyph prose-width-glyph--narrow')
  const wide = element('span', 'prose-width-glyph prose-width-glyph--wide')
  const input = document.createElement('input')
  input.type = 'range'
  input.className = 'prose-width-range'
  input.min = String(PROSE_MIN)
  input.max = String(PROSE_MAX)
  input.step = '20'
  input.value = String(current)
  input.setAttribute('aria-label', 'Ancho del texto')
  input.setAttribute('aria-valuetext', proseLabel(current))
  input.title = `Ancho del texto: ${proseLabel(current)}`
  input.addEventListener('input', () => {
    setProse(Number(input.value))
  })
  input.addEventListener('dblclick', () => {
    setProse(PROSE_DEFAULT)
  })
  wrap.append(narrow, input, wide)
  return wrap
}
