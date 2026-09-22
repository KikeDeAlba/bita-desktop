import { element } from '../dom.ts'
import { adoptSvg } from './svg.ts'
import { openDiagram } from './lightbox.ts'

const SOURCE_MAX = 20_000
const PER_PAGE_MAX = 20

let ready: Promise<typeof import('mermaid').default> | null = null
let drawn = 0

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

async function engine(): Promise<typeof import('mermaid').default> {
  if (ready !== null) return ready

  ready = import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: "'Instrument Sans', system-ui, sans-serif",
      flowchart: { htmlLabels: false },
      class: { htmlLabels: false },
      themeVariables: {
        background: token('--inset'),
        mainBkg: token('--card'),
        primaryColor: token('--card'),
        primaryTextColor: token('--fg-bright'),
        primaryBorderColor: token('--elev-strong'),
        secondaryColor: token('--blue'),
        tertiaryColor: token('--aqua'),
        lineColor: token('--fg-mute'),
        textColor: token('--fg'),
        errorBkgColor: token('--danger'),
        fontSize: '13px',
      },
      themeCSS: "text, .label { font-family: 'Instrument Sans', system-ui, sans-serif; }",
    })
    return mermaid
  })

  return ready
}

export function resetPage(): void {
  drawn = 0
}

export function mermaidFigure(source: string, onCopy: (text: string) => void): HTMLElement {
  const figure = element('figure', 'md-mermaid')

  const head = element('figcaption', 'md-mermaid-head')
  head.append(element('span', 'md-mermaid-kind', 'mermaid'))

  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'md-mermaid-toggle'
  toggle.textContent = 'Ver código'
  head.append(toggle)

  const copy = document.createElement('button')
  copy.type = 'button'
  copy.className = 'md-mermaid-toggle'
  copy.textContent = 'Copiar'
  copy.addEventListener('click', () => {
    onCopy(source)
  })
  head.append(copy)

  const stage = element('div', 'md-mermaid-stage')
  stage.append(element('p', 'md-mermaid-note', 'Dibujando el diagrama…'))

  const code = element('pre', 'md-code md-mermaid-source')
  code.append(element('code', '', source))
  code.hidden = true

  toggle.addEventListener('click', () => {
    code.hidden = !code.hidden
    stage.hidden = !code.hidden
    toggle.textContent = code.hidden ? 'Ver código' : 'Ver diagrama'
  })

  figure.append(head, stage, code)

  if (source.length > SOURCE_MAX || drawn >= PER_PAGE_MAX) {
    degrade(figure, stage, code, toggle, 'El diagrama es demasiado grande para dibujarlo aquí.')
    return figure
  }

  drawn += 1
  void draw(source, figure, stage, code, toggle)
  return figure
}

async function draw(
  source: string,
  figure: HTMLElement,
  stage: HTMLElement,
  code: HTMLElement,
  toggle: HTMLButtonElement,
): Promise<void> {
  const id = `mermaid-${Math.random().toString(36).slice(2, 10)}`

  try {
    const mermaid = await engine()
    await mermaid.parse(source)
    const { svg } = await mermaid.render(id, source)

    const adopted = adoptSvg(svg)
    if (adopted === null) {
      degrade(figure, stage, code, toggle, 'El diagrama no se pudo leer.')
      return
    }

    const shadow = stage.shadowRoot ?? stage.attachShadow({ mode: 'open' })
    shadow.replaceChildren(adopted)
    stage.replaceChildren()

    const label = kindOf(source)
    stage.classList.add('md-mermaid-stage--ready')
    stage.setAttribute('role', 'button')
    stage.setAttribute('tabindex', '0')
    stage.setAttribute('aria-label', `${label}: abrir a pantalla completa`)
    stage.title = 'Abrir a pantalla completa'

    const show = (): void => {
      openDiagram(adopted, label)
    }
    stage.addEventListener('click', show)
    stage.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      show()
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message.split('\n')[0] : 'no compila'
    degrade(figure, stage, code, toggle, `El diagrama no compila: ${reason ?? 'no compila'}`)
  } finally {
    document.getElementById(id)?.remove()
    document.querySelector(`#d${id}`)?.remove()
  }
}

function kindOf(source: string): string {
  const first = source.trim().split(/\s|\n/)[0]?.toLowerCase() ?? ''
  if (first.startsWith('sequence')) return 'Diagrama de secuencia'
  if (first.startsWith('flowchart') || first.startsWith('graph')) return 'Diagrama de flujo'
  if (first.startsWith('erdiagram')) return 'Diagrama entidad relación'
  if (first.startsWith('statediagram')) return 'Diagrama de estados'
  if (first.startsWith('gantt')) return 'Diagrama de Gantt'
  return 'Diagrama'
}

function degrade(
  figure: HTMLElement,
  stage: HTMLElement,
  code: HTMLElement,
  toggle: HTMLButtonElement,
  reason: string,
): void {
  figure.classList.add('md-mermaid--broken')
  stage.hidden = true
  code.hidden = false
  toggle.textContent = 'Ver diagrama'
  toggle.disabled = true
  figure.append(element('p', 'md-mermaid-broken', reason))
}
