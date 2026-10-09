export function must<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector)
  if (found === null) throw new Error(`falta ${selector} en el panel`)
  return found
}

export function element(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  if (className !== undefined) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

interface IconShape {
  view: string
  path: string
  stroke?: boolean
  weight?: number
}

const ICONS: Record<string, IconShape> = {
  stop: { view: '0 0 14 14', path: '<rect x="3" y="3" width="8" height="8" rx="1.6" fill="currentColor"/>' },
  play: { view: '0 0 12 12', path: '<path d="M3.6 2.4 9.4 6 3.6 9.6Z" fill="currentColor"/>' },
  pause: { view: '0 0 12 12', path: '<path d="M3 2.2h2.2v7.6H3zM6.8 2.2H9v7.6H6.8z" fill="currentColor"/>' },
  mic: {
    view: '0 0 16 16',
    stroke: true,
    path: '<rect x="5.5" y="1.5" width="5" height="8" rx="2.5"/><path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2"/>',
  },
  screen: {
    view: '0 0 16 16',
    stroke: true,
    path: '<rect x="1.5" y="3" width="13" height="8.5" rx="1.5"/><path d="M5.5 14h5"/>',
  },
  rewind: { view: '0 0 16 16', stroke: true, path: '<path d="M3 4v3.5h3.5"/><path d="M3.5 7.5A5 5 0 1 1 5 11.5"/>' },
  captions: {
    view: '0 0 16 16',
    stroke: true,
    path: '<rect x="1.5" y="3" width="13" height="10" rx="1.5"/><path d="M4.5 10h3M9.5 10h2"/>',
  },
  fullscreen: { view: '0 0 16 16', stroke: true, path: '<path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/>' },
  folder: { view: '0 0 16 16', stroke: true, path: '<path d="M2 4.5h4l1.5 1.5H14v6.5H2z"/>' },
  copy: {
    view: '0 0 16 16',
    stroke: true,
    path: '<rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5"/>',
  },
  doc: {
    view: '0 0 16 16',
    stroke: true,
    path: '<path d="M9 1.9H4.3a1.2 1.2 0 0 0-1.2 1.2v9.8a1.2 1.2 0 0 0 1.2 1.2h7.4a1.2 1.2 0 0 0 1.2-1.2V5.9Z"/><path d="M9 1.9v4h3.9M5.6 8.6h4.8M5.6 11h3.2"/>',
  },
  chevronRight: { view: '0 0 16 16', stroke: true, path: '<path d="M6.2 3.6 10.6 8l-4.4 4.4"/>' },
  chevronDown: { view: '0 0 16 16', stroke: true, path: '<path d="M3.6 6.2 8 10.6l4.4-4.4"/>' },
  prev: { view: '0 0 16 16', stroke: true, path: '<path d="M9.8 3.8 5.6 8l4.2 4.2"/>' },
  next: { view: '0 0 16 16', stroke: true, path: '<path d="M6.2 3.8 10.4 8l-4.2 4.2"/>' },
  up: { view: '0 0 16 16', stroke: true, path: '<path d="M3.8 9.8 8 5.6l4.2 4.2"/>' },
  down: { view: '0 0 16 16', stroke: true, path: '<path d="M3.8 6.2 8 10.4l4.2-4.2"/>' },
  search: { view: '0 0 16 16', stroke: true, path: '<circle cx="7" cy="7" r="4.4"/><path d="M10.4 10.4 14 14"/>' },
  close: { view: '0 0 16 16', stroke: true, path: '<path d="M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2"/>' },
  external: {
    view: '0 0 16 16',
    stroke: true,
    path: '<path d="M9.4 2.6h4v4M13.4 2.6 7.6 8.4M11.4 9.6v3.2a.8.8 0 0 1-.8.8H3.4a.8.8 0 0 1-.8-.8V5.6a.8.8 0 0 1 .8-.8h3.2"/>',
  },
  panelLeft: {
    view: '0 0 16 16',
    stroke: true,
    path: '<rect x="2.2" y="3" width="11.6" height="10" rx="2.2"/><path d="M6.4 3v10"/>',
  },
  panelRight: {
    view: '0 0 16 16',
    stroke: true,
    path: '<rect x="2.2" y="3" width="11.6" height="10" rx="2.2"/><path d="M9.6 3v10"/>',
  },
  task: {
    view: '0 0 16 16',
    stroke: true,
    path: '<rect x="2.4" y="2.4" width="11.2" height="11.2" rx="2.6"/><path d="M5.4 8.2 7.4 10.2l3.4-3.8"/>',
  },
  clock: {
    view: '0 0 16 16',
    stroke: true,
    path: '<circle cx="8" cy="8" r="5.6"/><path d="M8 4.6V8l2.4 1.5"/>',
  },
  list: {
    view: '0 0 16 16',
    stroke: true,
    path: '<path d="M3 4.4h10M3 8h7M3 11.6h8.6"/>',
  },
  plus: { view: '0 0 16 16', stroke: true, path: '<path d="M8 3.2v9.6M3.2 8h9.6"/>' },
  check: { view: '0 0 16 16', stroke: true, path: '<path d="M3.6 8.4 6.6 11.2 12.4 4.8"/>' },
  calendar: {
    view: '0 0 16 16',
    stroke: true,
    path: '<rect x="2.2" y="3.2" width="11.6" height="10.6" rx="1.6"/><path d="M2.2 6.6h11.6M5.4 1.8v2.6M10.6 1.8v2.6"/>',
  },
  database: {
    view: '0 0 16 16',
    stroke: true,
    path: '<ellipse cx="8" cy="4" rx="5.4" ry="2"/><path d="M2.6 4v8c0 1.1 2.4 2 5.4 2s5.4-.9 5.4-2V4M2.6 8c0 1.1 2.4 2 5.4 2s5.4-.9 5.4-2"/>',
  },
  sliders: {
    view: '0 0 16 16',
    stroke: true,
    path: '<path d="M2.6 4h6.6M12 4h1.4M2.6 8h2.4M8 8h5.4M2.6 12h8M13.4 12h0"/><circle cx="10.6" cy="4" r="1.4"/><circle cx="6.6" cy="8" r="1.4"/><circle cx="12" cy="12" r="1.4"/>',
  },
  download: { view: '0 0 16 16', stroke: true, path: '<path d="M8 2.4v8M4.8 7.4 8 10.6l3.2-3.2M3.2 13.6h9.6"/>' },
  trash: {
    view: '0 0 16 16',
    stroke: true,
    path: '<path d="M2.8 4.4h10.4M6.4 4.4V2.8h3.2v1.6M4.2 4.4l.6 8.6a1 1 0 0 0 1 .9h4.4a1 1 0 0 0 1-.9l.6-8.6"/>',
  },
  compress: { view: '0 0 16 16', stroke: true, path: '<path d="M5.6 2.4v3.2H2.4M10.4 2.4v3.2h3.2M5.6 13.6v-3.2H2.4M10.4 13.6v-3.2h3.2"/>' },
  wave: { view: '0 0 16 16', stroke: true, path: '<path d="M1.6 8h2l2-5.2 3.2 10.4 2-5.2h3.6"/>' },
  follow: { view: '0 0 16 16', stroke: true, path: '<circle cx="8" cy="8" r="2"/><circle cx="8" cy="8" r="5.4"/>' },
  inbox: {
    view: '0 0 16 16',
    stroke: true,
    path: '<path d="M2.6 9.2 4.4 3.6h7.2l1.8 5.6v3.2a.8.8 0 0 1-.8.8H3.4a.8.8 0 0 1-.8-.8Z"/><path d="M2.6 9.2h3.2l.8 1.6h2.8l.8-1.6h3.2"/>',
  },
  image: {
    view: '0 0 16 16',
    stroke: true,
    path: '<rect x="2" y="3.2" width="12" height="9.6" rx="1.4"/><circle cx="6" cy="6.6" r="1.2"/><path d="M14 10.6 10.6 7.2 5 12.8"/>',
  },
  refresh: {
    view: '0 0 16 16',
    stroke: true,
    path: '<path d="M2.8 8a5.2 5.2 0 0 1 9.2-3.4l1.2 1.4M13.2 2.8V6H10M13.2 8A5.2 5.2 0 0 1 4 11.4L2.8 10M2.8 13.2V10H6"/>',
  },
  link: {
    view: '0 0 16 16',
    stroke: true,
    path: '<path d="M6.8 9.2a2.6 2.6 0 0 0 3.8 0l2-2a2.7 2.7 0 0 0-3.8-3.8l-.7.7M9.2 6.8a2.6 2.6 0 0 0-3.8 0l-2 2a2.7 2.7 0 0 0 3.8 3.8l.7-.7"/>',
  },
  warning: {
    view: '0 0 16 16',
    stroke: true,
    path: '<path d="M8 2.2 14.6 13.6H1.4Z"/><path d="M8 6.6v3M8 11.6v.2"/>',
  },
  question: {
    view: '0 0 24 24',
    stroke: true,
    weight: 2,
    path: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  },
  spinner: { view: '0 0 24 24', stroke: true, weight: 2.2, path: '<path d="M21 12a9 9 0 1 1-6.22-8.56"/>' },
  send: {
    view: '0 0 24 24',
    stroke: true,
    weight: 2,
    path: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/>',
  },
  eyeOff: {
    view: '0 0 24 24',
    stroke: true,
    weight: 2,
    path: '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="M2 2l20 20"/>',
  },
  minus: { view: '0 0 24 24', stroke: true, weight: 2, path: '<path d="M5 12h14"/>' },
  code: { view: '0 0 24 24', stroke: true, weight: 2, path: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>' },
  commit: {
    view: '0 0 24 24',
    stroke: true,
    weight: 2,
    path: '<circle cx="12" cy="12" r="4"/><path d="M1.05 12H7M17.01 12h5.95"/>',
  },
  keyboard: {
    view: '0 0 24 24',
    stroke: true,
    weight: 2,
    path: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/>',
  },
  bars: { view: '0 0 24 24', stroke: true, weight: 2.2, path: '<path d="M2 12h2M6 8v8M10 5v14M14 9v6M18 7v10M22 12h-2"/>' },
  history: {
    view: '0 0 16 16',
    stroke: true,
    path: '<path d="M2.6 8a5.4 5.4 0 1 0 1.6-3.8L2.6 5.8"/><path d="M2.6 2.8v3h3M8 5.2V8l2 1.2"/>',
  },
  edit: {
    view: '0 0 16 16',
    stroke: true,
    path: '<path d="M10.6 2.8l2.6 2.6-7.6 7.6H3v-2.6Z"/>',
  },
  expand: {
    view: '0 0 24 24',
    stroke: true,
    weight: 2,
    path: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  },
  shrink: {
    view: '0 0 24 24',
    stroke: true,
    weight: 2,
    path: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
  },
  rotate: {
    view: '0 0 24 24',
    stroke: true,
    weight: 2,
    path: '<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  },
  more: {
    view: '0 0 16 16',
    path: '<circle cx="3.6" cy="8" r="1.2" fill="currentColor"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="12.4" cy="8" r="1.2" fill="currentColor"/>',
  },
}

export function icon(name: keyof typeof ICONS, size = 12): SVGSVGElement {
  const shape = ICONS[name] ?? ICONS['stop']
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('viewBox', shape?.view ?? '0 0 16 16')
  svg.setAttribute('aria-hidden', 'true')
  if (shape?.stroke === true) {
    svg.setAttribute('fill', 'none')
    svg.setAttribute('stroke', 'currentColor')
    svg.setAttribute('stroke-width', String(shape.weight ?? 1.5))
    svg.setAttribute('stroke-linecap', 'round')
    svg.setAttribute('stroke-linejoin', 'round')
  }
  svg.innerHTML = shape?.path ?? ''
  return svg
}

export function iconButton(
  name: Parameters<typeof icon>[0],
  className: string,
  label: string,
): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.setAttribute('aria-label', label)
  button.append(icon(name))
  return button
}
