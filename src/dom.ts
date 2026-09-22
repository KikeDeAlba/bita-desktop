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
}

const ICONS: Record<string, IconShape> = {
  stop: { view: '0 0 14 14', path: '<rect x="3" y="3" width="8" height="8" rx="1.6" fill="currentColor"/>' },
  play: { view: '0 0 12 12', path: '<path d="M3.6 2.4 9.4 6 3.6 9.6Z" fill="currentColor"/>' },
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
    svg.setAttribute('stroke-width', '1.5')
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
