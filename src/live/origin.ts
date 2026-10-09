import type { MeetingSegment } from '../bita.ts'
import { offsetOf } from './render.ts'

export interface Origin {
  ms: number | null
  channel: string | null
  line: number | null
}

export interface OriginInput {
  question: string
  questionMs?: number | undefined
  channel?: string | undefined
  askedAt: string | null
  startedAt: string | null | undefined
}

const LOOKBACK_MS = 180_000
const AHEAD_MS = 2_000
const NEAR_MS = 15_000
const MIN_SIMILARITY = 0.3

export function tokens(text: string): Set<string> {
  const folded = text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('es')
  return new Set(folded.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3))
}

export function similarity(left: string, right: string): number {
  const a = tokens(left)
  const b = tokens(right)
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const word of a) if (b.has(word)) shared += 1
  return (2 * shared) / (a.size + b.size)
}

export function lineAt(lines: MeetingSegment[], ms: number, channel: string | null): number | null {
  let best: number | null = null
  let bestScore = Number.POSITIVE_INFINITY
  lines.forEach((segment, index) => {
    const covers = segment.startMs <= ms && ms <= Math.max(segment.endMs, segment.startMs)
    const distance = covers ? 0 : Math.min(Math.abs(segment.startMs - ms), Math.abs(segment.endMs - ms))
    if (distance > NEAR_MS) return
    const penalty = channel !== null && segment.channel !== channel ? NEAR_MS : 0
    const score = distance + penalty
    if (score <= bestScore) {
      best = index
      bestScore = score
    }
  })
  return best
}

export function closestLine(lines: MeetingSegment[], question: string, beforeMs: number): number | null {
  let best: number | null = null
  let bestScore = MIN_SIMILARITY
  lines.forEach((segment, index) => {
    if (segment.startMs > beforeMs + AHEAD_MS || segment.startMs < beforeMs - LOOKBACK_MS) return
    const score = similarity(segment.text, question)
    if (score >= bestScore) {
      best = index
      bestScore = score
    }
  })
  return best
}

export function originOf(input: OriginInput, lines: MeetingSegment[]): Origin {
  if (input.questionMs !== undefined && Number.isFinite(input.questionMs)) {
    const line = lineAt(lines, input.questionMs, input.channel ?? null)
    const channel = input.channel ?? (line === null ? null : (lines[line]?.channel ?? null))
    return { ms: input.questionMs, channel, line }
  }
  const asked = offsetOf(input.askedAt, input.startedAt)
  if (asked === null) return { ms: null, channel: null, line: null }
  const line = input.question.trim().length === 0 ? null : closestLine(lines, input.question, asked)
  const segment = line === null ? undefined : lines[line]
  if (segment === undefined) return { ms: asked, channel: null, line: null }
  return { ms: segment.startMs, channel: segment.channel, line }
}
