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

const ICONS = {
  stop: '<rect x="3" y="3" width="8" height="8" rx="1.6" fill="currentColor"/>',
  play: '<path d="M3.6 2.4 9.4 6 3.6 9.6Z" fill="currentColor"/>',
} as const

export function icon(name: keyof typeof ICONS, size = 12): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('viewBox', name === 'stop' ? '0 0 14 14' : '0 0 12 12')
  svg.setAttribute('aria-hidden', 'true')
  svg.innerHTML = ICONS[name]
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
