import {
  backlogAdd,
  copyText,
  describeProblem,
  liveAsk,
  liveState,
  onLiveAnswer,
  onLiveState,
  onLiveTranscript,
  type AnswerSource,
  type AskingState,
  type LiveAnswer,
  type LiveTranscriptUpdate,
  type LiveView,
  type StreamEvent,
} from '../bita.ts'
import { ERROR_TEXT, sameQuestion } from './render.ts'

export interface Current {
  askId: number
  startedAt: string
  question: string
  progress: string | null
  text: string
  sources: AnswerSource[]
  done: LiveAnswer | null
  error: { code: string; message: string } | null
}

export interface SessionHooks {
  paint: () => void
  flash: (message: string) => void
  meetingChanged?: () => void
  reloaded?: () => void
  transcript?: (update: LiveTranscriptUpdate) => void
}

const LANDED_SLACK_MS = 5000

export const EMPTY_VIEW: LiveView = {
  active: null,
  title: null,
  entryId: null,
  project: null,
  transcript: [],
  answers: [],
  asking: false,
  pendingAsk: null,
  shortcut: 'Ctrl+Alt+Space',
  visible: true,
  mode: 'compact',
}

export class Session {
  view: LiveView = { ...EMPTY_VIEW }
  current: Current | null = null
  watched: AskingState | null = null
  focus: string | null = null
  backlogged = new Set<string>()
  backlogBusy = new Set<string>()

  private readonly hooks: SessionHooks

  constructor(hooks: SessionHooks) {
    this.hooks = hooks
  }

  manualStreaming(): boolean {
    return this.current !== null && this.current.done === null && this.current.error === null
  }

  landed(pending: AskingState): LiveAnswer | undefined {
    const question = pending.question
    if (question === null) return undefined
    const started = pending.startedAt === null ? Number.NaN : new Date(pending.startedAt).getTime()
    return this.view.answers.findLast((answer) => {
      if (answer.auto !== true || !sameQuestion(answer.question, question)) return false
      if (!Number.isFinite(started)) return true
      const asked = new Date(answer.askedAt).getTime()
      return !Number.isFinite(asked) || asked >= started - LANDED_SLACK_MS
    })
  }

  detectedPending(): AskingState | null {
    const pending = this.view.pendingAsk
    if (pending === null || !pending.auto || pending.question === null) return null
    if (this.manualStreaming() || this.landed(pending) !== undefined) return null
    return pending
  }

  followDetected(): void {
    const pending = this.detectedPending()
    if (pending !== null) {
      const watched = this.watched
      if (watched === null || watched.startedAt !== pending.startedAt || watched.question !== pending.question) {
        this.watched = pending
        this.current = null
        this.focus = null
      }
      return
    }
    if (this.watched === null) return
    const answer = this.landed(this.watched)
    this.watched = null
    if (answer !== undefined && !this.manualStreaming()) {
      this.current = null
      this.focus = answer.id
    }
  }

  copy(text: string): void {
    void copyText(text)
      .then(() => this.hooks.flash('Copiado'))
      .catch(() => this.hooks.flash('No se pudo copiar'))
  }

  start(askId: number, question: string): void {
    this.current = { askId, startedAt: new Date().toISOString(), question, progress: null, text: '', sources: [], done: null, error: null }
    this.focus = null
    this.watched = null
    this.hooks.paint()
  }

  ask(question: string | null): void {
    void liveAsk(question)
      .then((askId) => {
        if (this.current === null || this.current.askId < askId) this.start(askId, question ?? '')
      })
      .catch((error: unknown) => {
        const problem = describeProblem(error)
        this.current = {
          askId: 0,
          startedAt: new Date().toISOString(),
          question: question ?? '',
          progress: null,
          text: '',
          sources: [],
          done: null,
          error: { code: 'FAILED', message: problem.message },
        }
        this.hooks.paint()
      })
  }

  apply(askId: number, event: StreamEvent): void {
    if (askId === 0) {
      if (event.type === 'error') {
        this.current = {
          askId: 0,
          startedAt: new Date().toISOString(),
          question: '',
          progress: null,
          text: '',
          sources: [],
          done: null,
          error: { code: event.code, message: event.message },
        }
        this.hooks.paint()
      }
      return
    }
    if (this.current === null || this.current.askId < askId) this.start(askId, '')
    const current = this.current
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
      if (!this.view.answers.some((answer) => answer.id === event.answer.id)) {
        this.view.answers = [...this.view.answers, event.answer]
      }
    }
    if (event.type === 'error') {
      if (event.code === 'CANCELLED') return
      current.error = { code: event.code, message: ERROR_TEXT[event.code] ?? event.message }
    }
    this.hooks.paint()
  }

  toBacklog(answer: LiveAnswer): void {
    this.backlogBusy.add(answer.id)
    this.hooks.paint()
    void backlogAdd('pending', answer.question, answer.answer, null, this.view.project)
      .then(() => {
        this.backlogged.add(answer.id)
      })
      .catch((error: unknown) => this.hooks.flash(describeProblem(error).message))
      .finally(() => {
        this.backlogBusy.delete(answer.id)
        this.hooks.paint()
      })
  }

  backlogState(answer: LiveAnswer): { done: boolean; busy: boolean } {
    return { done: this.backlogged.has(answer.id), busy: this.backlogBusy.has(answer.id) }
  }

  async reload(): Promise<boolean> {
    const previous = this.view.active?.meetingId ?? null
    try {
      this.view = await liveState()
    } catch {
      return false
    }
    const changed = (this.view.active?.meetingId ?? null) !== previous
    if (changed) {
      this.current = null
      this.focus = null
      this.watched = null
      this.backlogged = new Set()
      this.hooks.meetingChanged?.()
    }
    this.followDetected()
    this.hooks.paint()
    this.hooks.reloaded?.()
    return changed
  }

  listen(): void {
    onLiveAnswer(({ askId, event }) => this.apply(askId, event))
    onLiveState(() => {
      void this.reload()
    })
    onLiveTranscript((update) => {
      if (this.view.active?.meetingId !== update.meetingId) return
      this.view.transcript = update.transcript
      if (this.hooks.transcript === undefined) this.hooks.paint()
      else this.hooks.transcript(update)
    })
  }
}
