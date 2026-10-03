import { mediaSrc, type MeetingSegment, type MeetingView, type PageMeeting, type Problem } from '../bita.ts'
import { element, icon } from '../dom.ts'
import { clock, human } from '../format.ts'
import { renderMarkdown } from './markdown.ts'

export type MeetingTab = 'document' | 'minutes' | 'transcript' | 'meeting'

export type MeetingLoad =
  | { state: 'loading' }
  | { state: 'ready'; view: MeetingView }
  | { state: 'missing' }
  | { state: 'failed'; problem: Problem }

export interface MeetingContext {
  info: PageMeeting
  tab: MeetingTab
  load: MeetingLoad
}

export interface MeetingHandlers {
  onTab: (tab: MeetingTab) => void
  onSeek: (seconds: number) => void
  onLink: (url: string) => void
  onCopy: (text: string) => void
}

export interface MinutesCounts {
  agreements: number
  pending: number
  questions: number
}

export interface Marker {
  seconds: number
  kind: 'agreement' | 'pending'
}

export interface Paragraph {
  startMs: number
  endMs: number
  channel: string
  text: string
}

const STAMP = /\[(\d{1,2}):(\d{2}):(\d{2})\]/g
const PARAGRAPH_GAP_MS = 4_000
const PARAGRAPH_SPAN_MS = 30_000
const SPEEDS = [1, 1.25, 1.5, 2]
const CHANNEL_LABEL: Record<string, string> = { mic: 'Sala', system: 'Remotos' }

export const MEETING_KINDS = ['remote-meeting', 'in-person-meeting']

export function isRemote(info: PageMeeting): boolean {
  return info.kind === 'remote-meeting'
}

export function latestMeeting(meetings: PageMeeting[] | undefined): PageMeeting | null {
  const list = (meetings ?? []).filter((meeting) => MEETING_KINDS.includes(meeting.kind))
  return list.reduce<PageMeeting | null>(
    (latest, meeting) => (latest === null || meeting.startedAt > latest.startedAt ? meeting : latest),
    null,
  )
}

export function tabsFor(info: PageMeeting): MeetingTab[] {
  return isRemote(info) ? ['document', 'minutes', 'transcript', 'meeting'] : ['document', 'minutes', 'transcript']
}

const TAB_LABEL: Record<MeetingTab, string> = {
  document: 'Documento',
  minutes: 'Minuta',
  transcript: 'Transcripción',
  meeting: 'Reunión',
}

export function meetingWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(0, 16)
  const day = date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '')
  const time = date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${day} · ${time}`
}

export function meetingShortDay(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(5, 10)
  return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }).replace('.', '')
}

export function durationLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} s`
  return human(seconds)
}

export function meetingChip(info: PageMeeting): HTMLElement {
  const row = element('div', 'meeting-meta')
  const chip = element('span', isRemote(info) ? 'meeting-chip meeting-chip--remote' : 'meeting-chip')
  chip.append(icon(isRemote(info) ? 'screen' : 'mic', 13), element('span', '', isRemote(info) ? 'Reunión remota' : 'Reunión presencial'))
  row.append(chip)
  row.append(element('span', 'meeting-meta-item', meetingWhen(info.startedAt)))
  row.append(element('span', 'meeting-meta-item', durationLabel(info.durationSeconds)))
  row.append(element('span', 'meeting-meta-item', `entrada #${info.entryId}`))
  return row
}

export function tabBar(info: PageMeeting, active: MeetingTab, onTab: (tab: MeetingTab) => void): HTMLElement {
  const bar = element('div', 'meeting-tabs')
  bar.setAttribute('role', 'tablist')
  bar.setAttribute('aria-label', 'Vista de la página')
  for (const tab of tabsFor(info)) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = tab === active ? 'meeting-tab meeting-tab--on' : 'meeting-tab'
    button.setAttribute('role', 'tab')
    button.setAttribute('aria-selected', String(tab === active))
    button.textContent = TAB_LABEL[tab]
    button.addEventListener('click', () => onTab(tab))
    bar.append(button)
  }
  return bar
}

function stampSeconds(hours: string, minutes: string, seconds: string): number {
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)
}

export function minutesBody(markdown: string): string {
  const start = markdown.search(/^##\s+/m)
  return start === -1 ? markdown : markdown.slice(start)
}

export function sectionOf(markdown: string, heading: string): string {
  const lines = markdown.split('\n')
  const wanted = heading.toLowerCase()
  const out: string[] = []
  let inside = false
  for (const line of lines) {
    const match = /^##\s+(.*\S)\s*$/.exec(line)
    if (match?.[1] !== undefined) {
      inside = match[1].toLowerCase().startsWith(wanted)
      continue
    }
    if (inside) out.push(line)
  }
  return out.join('\n')
}

export function minutesCounts(markdown: string): MinutesCounts {
  const agreements = sectionOf(markdown, 'Acuerdos')
    .split('\n')
    .filter((line) => /^\s*\d+[.)]\s+/.test(line)).length
  const pending = sectionOf(markdown, 'Pendientes')
    .split('\n')
    .filter((line) => /^\s*\|/.test(line) && !/^\s*\|\s*[-:]/.test(line))
    .slice(1).length
  const questions = sectionOf(markdown, 'Preguntas abiertas')
    .split('\n')
    .filter((line) => /^\s*[-*]\s+/.test(line) && !/ninguna/i.test(line)).length
  return { agreements, pending, questions }
}

export function minutesMarkers(markdown: string): Marker[] {
  const markers: Marker[] = []
  for (const [heading, kind] of [
    ['Acuerdos', 'agreement'],
    ['Pendientes', 'pending'],
  ] as const) {
    for (const match of sectionOf(markdown, heading).matchAll(STAMP)) {
      markers.push({ seconds: stampSeconds(match[1] ?? '0', match[2] ?? '0', match[3] ?? '0'), kind })
    }
  }
  return markers
}

export function paragraphsOf(segments: MeetingSegment[]): Paragraph[] {
  const result: Paragraph[] = []
  let lastEnd = Number.NEGATIVE_INFINITY
  for (const segment of segments) {
    const last = result.at(-1)
    if (
      last !== undefined &&
      last.channel === segment.channel &&
      segment.startMs - lastEnd <= PARAGRAPH_GAP_MS &&
      segment.startMs - last.startMs < PARAGRAPH_SPAN_MS
    ) {
      last.text = `${last.text} ${segment.text}`
      last.endMs = segment.endMs
    } else {
      result.push({ startMs: segment.startMs, endMs: segment.endMs, channel: segment.channel, text: segment.text })
    }
    lastEnd = Math.max(lastEnd, segment.endMs)
  }
  return result
}

export function activityBars(segments: MeetingSegment[], durationSeconds: number, count: number): number[] {
  const total = Math.max(1, durationSeconds * 1000)
  const bucket = total / count
  const covered = new Array<number>(count).fill(0)
  for (const segment of segments) {
    for (let index = Math.floor(segment.startMs / bucket); index < count && index * bucket < segment.endMs; index += 1) {
      const from = Math.max(segment.startMs, index * bucket)
      const to = Math.min(segment.endMs, (index + 1) * bucket)
      if (to > from) covered[index] = (covered[index] ?? 0) + (to - from)
    }
  }
  return covered.map((value) => Math.min(1, value / bucket))
}

export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

let player: { key: string; media: HTMLMediaElement } | null = null
let captionsOn = true
let speedIndex = 0
let currentParagraphs: Paragraph[] = []

function mediaFor(view: MeetingView): HTMLMediaElement | null {
  if (view.recording === null) return null
  if (player?.key === view.id) return player.media
  player?.media.pause()
  const media = document.createElement(view.mode === 'remote' ? 'video' : 'audio')
  media.className = 'meeting-media'
  media.preload = 'metadata'
  media.src = mediaSrc(view.recording)
  media.playbackRate = SPEEDS[speedIndex] ?? 1
  for (const event of ['timeupdate', 'play', 'pause', 'loadedmetadata', 'ratechange']) {
    media.addEventListener(event, () => refreshPlayer(media))
  }
  player = { key: view.id, media }
  return media
}

export function seekTo(view: MeetingView, seconds: number): void {
  const media = mediaFor(view)
  if (media === null) return
  const go = () => {
    media.currentTime = seconds
    void media.play().catch(() => undefined)
  }
  if (media.readyState >= 1) go()
  else media.addEventListener('loadedmetadata', go, { once: true })
}

export function stopPlayback(): void {
  player?.media.pause()
}

function lengthOf(media: HTMLMediaElement, view: MeetingView): number {
  return Number.isFinite(media.duration) && media.duration > 0 ? media.duration : (view.durationSeconds ?? 0)
}

function refreshPlayer(media: HTMLMediaElement): void {
  const total = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : 0
  const ratio = total > 0 ? media.currentTime / total : 0
  for (const fill of document.querySelectorAll<HTMLElement>('.mp-fill')) fill.style.width = `${(ratio * 100).toFixed(2)}%`
  for (const head of document.querySelectorAll<HTMLElement>('.mp-head')) head.style.left = `${(ratio * 100).toFixed(2)}%`
  for (const label of document.querySelectorAll<HTMLElement>('.mp-time')) {
    label.textContent = `${clock(media.currentTime)} / ${clock(total)}`
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('.mp-play')) {
    button.replaceChildren(icon(media.paused ? 'play' : 'pause', 12))
    button.setAttribute('aria-label', media.paused ? 'Reproducir' : 'Pausar')
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('.mp-speed')) {
    button.textContent = `${media.playbackRate}×`
  }
  for (const bar of document.querySelectorAll<HTMLElement>('.mp-bar')) {
    bar.classList.toggle('mp-bar--played', Number(bar.dataset['at'] ?? '1') <= ratio)
  }
  const nowMs = media.currentTime * 1000
  const now = currentParagraphs.find((paragraph) => paragraph.startMs <= nowMs && nowMs < paragraph.endMs + PARAGRAPH_GAP_MS)
  for (const caption of document.querySelectorAll<HTMLElement>('.mp-caption')) {
    caption.textContent = now?.text ?? ''
    caption.hidden = !captionsOn || now === undefined
  }
  for (const row of document.querySelectorAll<HTMLElement>('.mt-row')) {
    row.classList.toggle('mt-row--now', now !== undefined && Number(row.dataset['start']) === now.startMs && !media.paused)
  }
}

function progress(view: MeetingView, media: HTMLMediaElement, markers: Marker[], frames: boolean, bars: number[] | null): HTMLElement {
  const track = element('div', bars === null ? 'mp-track' : 'mp-track mp-track--wave')
  track.setAttribute('role', 'slider')
  track.setAttribute('aria-label', 'Posición en la grabación')
  track.tabIndex = 0
  if (bars !== null) {
    const wave = element('div', 'mp-wave')
    bars.forEach((height, index) => {
      const bar = element('span', 'mp-bar')
      bar.dataset['at'] = String(index / bars.length)
      bar.style.height = `${Math.round(10 + height * 90)}%`
      wave.append(bar)
    })
    track.append(wave)
  } else {
    const rail = element('div', 'mp-rail')
    rail.append(element('div', 'mp-fill'))
    track.append(rail, element('div', 'mp-head'))
  }
  const total = lengthOf(media, view)
  if (total > 0) {
    for (const marker of markers) {
      const dot = element('span', marker.kind === 'agreement' ? 'mp-marker mp-marker--agreement' : 'mp-marker mp-marker--pending')
      dot.style.left = `${Math.min(100, (marker.seconds / total) * 100)}%`
      dot.title = `${marker.kind === 'agreement' ? 'Acuerdo' : 'Pendiente'} ${clock(marker.seconds)}`
      track.append(dot)
    }
    if (frames) {
      for (const frame of view.frames) {
        const box = element('span', 'mp-marker mp-marker--frame')
        box.style.left = `${Math.min(100, (frame.timeSeconds / total) * 100)}%`
        box.title = `Captura ${clock(frame.timeSeconds)}`
        track.append(box)
      }
    }
  }
  const jump = (clientX: number) => {
    const rect = track.getBoundingClientRect()
    const length = lengthOf(media, view)
    if (rect.width === 0 || length === 0) return
    media.currentTime = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * length
  }
  track.addEventListener('click', (event) => jump(event.clientX))
  track.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight') media.currentTime = Math.min(lengthOf(media, view), media.currentTime + 5)
    if (event.key === 'ArrowLeft') media.currentTime = Math.max(0, media.currentTime - 5)
  })
  return track
}

function controlButton(className: string, label: string, child: Node, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.setAttribute('aria-label', label)
  button.append(child)
  button.addEventListener('click', onClick)
  return button
}

function legend(withFrames: boolean): HTMLElement {
  const row = element('div', 'mp-legend')
  row.append(element('span', 'mp-key mp-key--agreement', 'acuerdo'), element('span', 'mp-key mp-key--pending', 'pendiente'))
  if (withFrames) row.append(element('span', 'mp-key mp-key--frame', 'captura'))
  return row
}

function controls(media: HTMLMediaElement, withFrames: boolean, video: HTMLElement | null): HTMLElement {
  const row = element('div', 'mp-controls')
  row.append(
    controlButton('mp-play', 'Reproducir', icon('play', 12), () => {
      if (media.paused) void media.play().catch(() => undefined)
      else media.pause()
    }),
    controlButton('mp-icon', 'Retroceder 10 segundos', icon('rewind', 15), () => {
      media.currentTime = Math.max(0, media.currentTime - 10)
    }),
    element('span', 'mp-time', '00:00:00 / 00:00:00'),
    element('span', 'spacer'),
    legend(withFrames),
  )
  const speed = document.createElement('button')
  speed.type = 'button'
  speed.className = 'mp-speed'
  speed.setAttribute('aria-label', 'Velocidad')
  speed.textContent = `${media.playbackRate}×`
  speed.addEventListener('click', () => {
    speedIndex = (speedIndex + 1) % SPEEDS.length
    media.playbackRate = SPEEDS[speedIndex] ?? 1
  })
  row.append(speed)
  if (video !== null) {
    const captions = controlButton('mp-icon', 'Subtítulos', icon('captions', 15), () => {
      captionsOn = !captionsOn
      captions.setAttribute('aria-pressed', String(captionsOn))
      refreshPlayer(media)
    })
    captions.setAttribute('aria-pressed', String(captionsOn))
    row.append(
      captions,
      controlButton('mp-icon', 'Pantalla completa', icon('fullscreen', 14), () => {
        void video.requestFullscreen().catch(() => undefined)
      }),
    )
  }
  return row
}

function stateNote(load: MeetingLoad): HTMLElement | null {
  if (load.state === 'loading') return element('p', 'placeholder', 'Leyendo la reunión…')
  if (load.state === 'missing') {
    const box = element('div', 'no-doc')
    box.append(element('span', 'no-doc-title', 'La grabación ya no está en este equipo'))
    box.append(element('p', 'no-doc-note', 'La página salió de una reunión, pero recap no tiene su carpeta.'))
    return box
  }
  if (load.state === 'failed') {
    const box = element('div', 'problem')
    box.append(element('div', 'problem-message', load.problem.message))
    if (load.problem.hint) box.append(element('div', 'problem-hint', load.problem.hint))
    return box
  }
  return null
}

function linkStamps(root: Node, onSeek: (seconds: number) => void): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  while (walker.nextNode()) texts.push(walker.currentNode as Text)
  for (const text of texts) {
    const value = text.nodeValue ?? ''
    if (!STAMP.test(value)) continue
    STAMP.lastIndex = 0
    const fragment = document.createDocumentFragment()
    let at = 0
    for (const match of value.matchAll(STAMP)) {
      const index = match.index ?? 0
      fragment.append(document.createTextNode(value.slice(at, index)))
      const seconds = stampSeconds(match[1] ?? '0', match[2] ?? '0', match[3] ?? '0')
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'stamp'
      button.textContent = clock(seconds)
      button.addEventListener('click', () => onSeek(seconds))
      fragment.append(button)
      at = index + match[0].length
    }
    fragment.append(document.createTextNode(value.slice(at)))
    text.replaceWith(fragment)
  }
}

export function renderMinutes(context: MeetingContext, handlers: MeetingHandlers): HTMLElement {
  const wrap = element('div', 'doc-body')
  const article = element('article', 'article meeting-article')
  const note = stateNote(context.load)
  if (note !== null || context.load.state !== 'ready') {
    if (note !== null) article.append(note)
    wrap.append(article)
    return wrap
  }
  const markdown = context.load.view.summaryMarkdown
  if (markdown === null) {
    article.append(element('p', 'doc-section-blank', 'Esta reunión todavía no tiene minuta.'))
    wrap.append(article)
    return wrap
  }
  const rendered = renderMarkdown(minutesBody(markdown), { onLink: handlers.onLink, onCopy: handlers.onCopy })
  linkStamps(rendered, handlers.onSeek)
  article.append(rendered)
  wrap.append(article)
  return wrap
}

function transcriptRows(view: MeetingView, remote: boolean, handlers: MeetingHandlers): HTMLElement {
  const list = element('div', 'mt-list')
  currentParagraphs = paragraphsOf(view.segments)
  if (currentParagraphs.length === 0) {
    list.append(element('p', 'doc-section-blank', 'No se detectó voz en la grabación.'))
    return list
  }
  for (const paragraph of currentParagraphs) {
    const row = element('div', remote ? 'mt-row mt-row--channels' : 'mt-row')
    row.dataset['start'] = String(paragraph.startMs)
    row.dataset['channel'] = paragraph.channel
    row.dataset['text'] = fold(paragraph.text)
    const stamp = document.createElement('button')
    stamp.type = 'button'
    stamp.className = 'stamp'
    stamp.textContent = clock(paragraph.startMs / 1000)
    stamp.addEventListener('click', () => handlers.onSeek(paragraph.startMs / 1000))
    row.append(stamp)
    if (remote) {
      row.append(element('span', `mt-channel mt-channel--${paragraph.channel}`, CHANNEL_LABEL[paragraph.channel] ?? paragraph.channel))
    }
    row.append(element('p', 'mt-text', paragraph.text))
    list.append(row)
  }
  return list
}

function highlight(paragraph: HTMLElement, text: string, query: string): void {
  paragraph.replaceChildren()
  if (query.length === 0) {
    paragraph.textContent = text
    return
  }
  const folded = fold(text)
  let at = 0
  let found = folded.indexOf(query)
  while (found !== -1) {
    paragraph.append(document.createTextNode(text.slice(at, found)))
    paragraph.append(element('mark', 'hit', text.slice(found, found + query.length)))
    at = found + query.length
    found = folded.indexOf(query, at)
  }
  paragraph.append(document.createTextNode(text.slice(at)))
}

function filterRows(list: HTMLElement, query: string, channel: string, counter: HTMLElement): void {
  const wanted = fold(query.trim())
  let matches = 0
  for (const row of list.querySelectorAll<HTMLElement>('.mt-row')) {
    const textMatch = wanted.length === 0 || (row.dataset['text'] ?? '').includes(wanted)
    const channelMatch = channel === 'all' || row.dataset['channel'] === channel
    row.hidden = !(textMatch && channelMatch)
    const paragraph = row.querySelector<HTMLElement>('.mt-text')
    const original = currentParagraphs.find((item) => String(item.startMs) === row.dataset['start'])
    if (paragraph !== null && original !== undefined) highlight(paragraph, original.text, wanted)
    if (!row.hidden && wanted.length > 0) matches += 1
  }
  counter.textContent = wanted.length === 0 ? '' : `${matches} ${matches === 1 ? 'coincidencia' : 'coincidencias'}`
}

export function renderTranscript(context: MeetingContext, handlers: MeetingHandlers): HTMLElement {
  const wrap = element('div', 'doc-body')
  const article = element('article', 'article meeting-article')
  const note = stateNote(context.load)
  if (note !== null || context.load.state !== 'ready') {
    if (note !== null) article.append(note)
    wrap.append(article)
    return wrap
  }
  const view = context.load.view
  const remote = isRemote(context.info)

  if (!remote) {
    const media = mediaFor(view)
    if (media !== null) {
      const card = element('div', 'mp-card')
      const head = element('div', 'mp-card-head')
      head.append(element('span', 'mp-card-title', 'Audio de la reunión'), element('span', 'mp-card-note', 'micrófono'))
      card.append(head, media)
      const markers = view.summaryMarkdown === null ? [] : minutesMarkers(view.summaryMarkdown)
      card.append(progress(view, media, markers, false, activityBars(view.segments, view.durationSeconds ?? 0, 80)))
      card.append(controls(media, false, null))
      article.append(card)
    }
  }

  const tools = element('div', 'mt-tools')
  const field = element('label', 'mt-search')
  field.append(element('span', 'visually-hidden', 'Buscar en la transcripción'))
  const input = document.createElement('input')
  input.type = 'search'
  input.placeholder = 'Buscar en la transcripción'
  input.autocomplete = 'off'
  input.spellcheck = false
  field.append(input)
  tools.append(field)

  let channel = 'all'
  const counter = element('span', 'mt-count')
  const list = transcriptRows(view, remote, handlers)

  if (remote) {
    const group = element('div', 'mt-channels')
    group.setAttribute('role', 'group')
    group.setAttribute('aria-label', 'Canal')
    for (const [value, label] of [
      ['all', 'Todos'],
      ['mic', 'Sala'],
      ['system', 'Remotos'],
    ] as const) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `mt-chip mt-chip--${value}`
      button.textContent = label
      button.setAttribute('aria-pressed', String(value === channel))
      button.addEventListener('click', () => {
        channel = value
        for (const other of group.querySelectorAll('button')) other.setAttribute('aria-pressed', String(other === button))
        filterRows(list, input.value, channel, counter)
      })
      group.append(button)
    }
    tools.append(group)
  }

  const copyAll = controlButton('ghost-button mt-copy', 'Copiar la transcripción', icon('copy', 12), () => {
    handlers.onCopy(currentParagraphs.map((paragraph) => `[${clock(paragraph.startMs / 1000)}] ${remote ? `${CHANNEL_LABEL[paragraph.channel] ?? paragraph.channel}: ` : ''}${paragraph.text}`).join('\n'))
  })
  copyAll.append(document.createTextNode('Copiar'))
  tools.append(copyAll, counter)
  input.addEventListener('input', () => filterRows(list, input.value, channel, counter))

  article.append(tools)
  if (remote) {
    const hint = element('div', 'mt-hint')
    const watch = controlButton('ghost-button', 'Ver en el video', icon('screen', 12), () => handlers.onTab('meeting'))
    watch.append(document.createTextNode('Ver en el video'))
    hint.append(watch, element('span', 'mt-hint-text', 'Un minuto abre la pestaña Reunión en ese punto.'))
    article.append(hint)
  }
  article.append(list)
  wrap.append(article)
  if (player !== null) refreshPlayer(player.media)
  return wrap
}

export function renderMeeting(context: MeetingContext): HTMLElement {
  const wrap = element('div', 'doc-body')
  const article = element('article', 'article meeting-article meeting-article--wide')
  const note = stateNote(context.load)
  if (note !== null || context.load.state !== 'ready') {
    if (note !== null) article.append(note)
    wrap.append(article)
    return wrap
  }
  const view = context.load.view
  currentParagraphs = paragraphsOf(view.segments)
  const media = mediaFor(view)
  if (media === null) {
    article.append(element('p', 'doc-section-blank', 'Esta reunión no tiene video.'))
    wrap.append(article)
    return wrap
  }

  const stage = element('div', 'mv-stage')
  stage.append(media)
  const badge = element('span', 'mv-badge')
  badge.append(element('span', 'mv-rec'), element('span', '', 'Pantalla, audio del sistema y micrófono'))
  const overlay = element('div', 'mv-overlay')
  const caption = element('p', 'mp-caption')
  caption.hidden = true
  const markers = view.summaryMarkdown === null ? [] : minutesMarkers(view.summaryMarkdown)
  overlay.append(caption, progress(view, media, markers, true, null), controls(media, true, stage))
  stage.append(badge, overlay)
  media.addEventListener('click', () => {
    if (media.paused) void media.play().catch(() => undefined)
    else media.pause()
  })
  article.append(stage)

  const framesHead = element('div', 'mv-frames-head')
  framesHead.append(element('h2', 'doc-section-title', 'Capturas clave'), element('span', 'mv-frames-note', 'Un clic salta a ese momento del video.'))
  article.append(framesHead)
  if (view.frames.length === 0) {
    article.append(element('p', 'doc-section-blank', 'Esta reunión no tiene capturas.'))
  } else {
    const grid = element('div', 'mv-frames')
    for (const frame of view.frames) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'mv-frame'
      button.setAttribute('aria-label', `Ir a ${clock(frame.timeSeconds)}`)
      const image = document.createElement('img')
      image.src = frame.src
      image.alt = `Captura de pantalla en ${clock(frame.timeSeconds)}`
      button.append(image, element('span', 'mv-frame-time', clock(frame.timeSeconds)))
      button.addEventListener('click', () => {
        media.currentTime = frame.timeSeconds
        void media.play().catch(() => undefined)
      })
      grid.append(button)
    }
    article.append(grid)
  }
  wrap.append(article)
  refreshPlayer(media)
  return wrap
}
