import type { DocSection, SectionState } from '../bita.ts'

export const FALLBACK_SECTIONS: readonly string[] = [
  'Contexto',
  'Qué se hizo',
  'Decisiones',
  'Hallazgos',
  'Verificación',
  'Pendiente',
  'Tocado',
]

export function anchorOf(heading: string): string {
  return `seccion-${heading
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`
}

export function stateLabel(state: SectionState): string {
  if (state === 'written') return 'escrita'
  if (state === 'empty') return 'vacía'
  return 'no está'
}

export function writtenCount(sections: DocSection[] | null): number {
  if (sections === null) return 0
  return sections.filter((section) => section.state === 'written').length
}

export function canonicalCount(sections: DocSection[] | null, fallback: readonly string[]): number {
  if (sections === null) return fallback.length
  const canonical = sections.filter((section) => section.canonical).length
  return canonical === 0 ? fallback.length : canonical
}

export function placeholderSections(headings: readonly string[]): DocSection[] {
  return headings.map((heading) => ({ heading, state: 'absent', canonical: true }))
}
