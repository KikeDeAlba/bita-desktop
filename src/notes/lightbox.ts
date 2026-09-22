import { element, icon } from '../dom.ts'

const SCALE_MIN = 0.2
const SCALE_MAX = 12
const WHEEL_STEP = 0.0015
const BUTTON_STEP = 1.25

interface View {
  scale: number
  x: number
  y: number
}

let open: (() => void) | null = null

export function closeDiagram(): void {
  open?.()
}

export function openDiagram(source: SVGElement, caption: string): void {
  closeDiagram()

  const svg = source.cloneNode(true) as SVGElement
  svg.removeAttribute('width')
  svg.removeAttribute('height')
  svg.style.width = 'auto'
  svg.style.height = 'auto'
  svg.style.maxWidth = 'none'
  svg.style.maxHeight = 'none'
  svg.style.display = 'block'

  const stage = element('div', 'lightbox-stage')
  stage.attachShadow({ mode: 'open' }).append(svg)

  const surface = element('div', 'lightbox-surface')
  surface.append(stage)

  const bar = element('div', 'lightbox-bar')
  bar.append(element('span', 'lightbox-caption', caption))

  const zoomOut = action('down', 'Alejar')
  const reset = document.createElement('button')
  reset.type = 'button'
  reset.className = 'lightbox-reset'
  reset.textContent = '100%'
  const zoomIn = action('up', 'Acercar')
  const close = action('close', 'Cerrar')
  bar.append(zoomOut, reset, zoomIn, close)

  const root = element('div', 'lightbox')
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-modal', 'true')
  root.setAttribute('aria-label', caption)
  root.append(bar, surface)
  document.body.append(root)

  const view: View = { scale: 1, x: 0, y: 0 }
  let fitted = 1

  const paint = (): void => {
    stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`
    reset.textContent = `${Math.round(view.scale * 100)}%`
  }

  const clamp = (value: number): number => Math.min(SCALE_MAX, Math.max(SCALE_MIN, value))

  const fit = (): void => {
    const box = svg.getBoundingClientRect()
    const area = surface.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) return

    const natural = view.scale === 0 ? 1 : view.scale
    const width = box.width / natural
    const height = box.height / natural

    fitted = clamp(Math.min((area.width - 64) / width, (area.height - 64) / height, 1))
    view.scale = fitted
    view.x = 0
    view.y = 0
    paint()
  }

  const zoomTo = (next: number, originX: number, originY: number): void => {
    const area = surface.getBoundingClientRect()
    const cx = originX - area.left - area.width / 2
    const cy = originY - area.top - area.height / 2
    const scaled = clamp(next)
    const ratio = scaled / view.scale

    view.x = cx - (cx - view.x) * ratio
    view.y = cy - (cy - view.y) * ratio
    view.scale = scaled
    paint()
  }

  const centre = (): { x: number; y: number } => {
    const area = surface.getBoundingClientRect()
    return { x: area.left + area.width / 2, y: area.top + area.height / 2 }
  }

  surface.addEventListener(
    'wheel',
    (event: WheelEvent) => {
      event.preventDefault()
      zoomTo(view.scale * Math.exp(-event.deltaY * WHEEL_STEP), event.clientX, event.clientY)
    },
    { passive: false },
  )

  let dragging: { x: number; y: number; id: number } | null = null

  surface.addEventListener('pointerdown', (event: PointerEvent) => {
    dragging = { x: event.clientX - view.x, y: event.clientY - view.y, id: event.pointerId }
    surface.setPointerCapture(event.pointerId)
    surface.classList.add('lightbox-surface--holding')
  })

  surface.addEventListener('pointermove', (event: PointerEvent) => {
    if (dragging === null || dragging.id !== event.pointerId) return
    view.x = event.clientX - dragging.x
    view.y = event.clientY - dragging.y
    paint()
  })

  const release = (event: PointerEvent): void => {
    if (dragging === null || dragging.id !== event.pointerId) return
    dragging = null
    surface.classList.remove('lightbox-surface--holding')
  }
  surface.addEventListener('pointerup', release)
  surface.addEventListener('pointercancel', release)

  surface.addEventListener('dblclick', () => {
    fit()
  })

  zoomIn.addEventListener('click', () => {
    const point = centre()
    zoomTo(view.scale * BUTTON_STEP, point.x, point.y)
  })
  zoomOut.addEventListener('click', () => {
    const point = centre()
    zoomTo(view.scale / BUTTON_STEP, point.x, point.y)
  })
  reset.addEventListener('click', fit)

  const shut = (): void => {
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('resize', fit)
    root.remove()
    open = null
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      shut()
      return
    }
    if (event.key === '0') {
      event.preventDefault()
      fit()
      return
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      const point = centre()
      zoomTo(view.scale * BUTTON_STEP, point.x, point.y)
      return
    }
    if (event.key === '-' || event.key === '_') {
      event.preventDefault()
      const point = centre()
      zoomTo(view.scale / BUTTON_STEP, point.x, point.y)
    }
  }

  close.addEventListener('click', shut)
  root.addEventListener('pointerdown', (event: PointerEvent) => {
    if (event.target === root) shut()
  })
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('resize', fit)
  open = shut

  paint()
  requestAnimationFrame(fit)
}

function action(name: 'up' | 'down' | 'close', label: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'lightbox-action'
  button.setAttribute('aria-label', label)
  button.append(icon(name, 14))
  return button
}
