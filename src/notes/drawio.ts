import { pageAsset } from '../bita.ts'
import { element } from '../dom.ts'
import { openDiagram } from './lightbox.ts'

const SVG_NS = 'http://www.w3.org/2000/svg'
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/
const RENDER_SCALE = 2

export interface DrawioContext {
  pageId: number
  assetsRelDir: string
  onOpen: (relPath: string) => void
}

export function assetsRelDirOf(pageRelPath: string): string {
  return pageRelPath.endsWith('.md') ? `${pageRelPath.slice(0, -3)}.assets` : `${pageRelPath}.assets`
}

export function drawioFileOf(body: string): string | null {
  const first = body.trim().split('\n')[0]?.trim() ?? ''
  if (first.length === 0) return null
  const file = first.endsWith('.drawio') ? first : `${first}.drawio`
  return ASSET_NAME.test(file) && !file.includes('..') ? file : null
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('the render could not be decoded'))
    image.src = url
  })
}

function asSvg(url: string, width: number, height: number): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  svg.setAttribute('width', String(width))
  svg.setAttribute('height', String(height))
  const image = document.createElementNS(SVG_NS, 'image')
  image.setAttribute('href', url)
  image.setAttribute('width', String(width))
  image.setAttribute('height', String(height))
  svg.append(image)
  return svg
}

export function drawioFigure(body: string, context: DrawioContext): HTMLElement {
  const figure = element('figure', 'md-mermaid md-drawio')
  const head = element('figcaption', 'md-mermaid-head')
  head.append(element('span', 'md-mermaid-kind', 'draw.io'))

  const file = drawioFileOf(body)
  const stage = element('div', 'md-mermaid-stage')
  figure.append(head, stage)

  if (file === null) {
    figure.classList.add('md-mermaid--broken')
    figure.append(element('p', 'md-mermaid-broken', 'El bloque drawio no nombra un archivo .drawio válido.'))
    return figure
  }

  const sourceRel = `${context.assetsRelDir}/${file}`
  const imageRel = `${context.assetsRelDir}/${file.slice(0, -'.drawio'.length)}.png`

  const open = document.createElement('button')
  open.type = 'button'
  open.className = 'md-mermaid-toggle'
  open.textContent = 'Abrir en draw.io'
  open.addEventListener('click', () => {
    context.onOpen(sourceRel)
  })
  head.append(open)

  stage.append(element('p', 'md-mermaid-note', 'Cargando el diagrama…'))
  void (async () => {
    try {
      const url = await pageAsset(imageRel)
      if (url === null) {
        stage.replaceChildren(element('p', 'md-mermaid-note', `Sin render: inkwell diagrams render ${context.pageId}`))
        return
      }
      const image = await loadImage(url)
      const width = Math.round(image.naturalWidth / RENDER_SCALE)
      const height = Math.round(image.naturalHeight / RENDER_SCALE)
      image.className = 'md-drawio-image'
      image.alt = file
      image.width = width
      image.height = height
      stage.replaceChildren(image)
      stage.classList.add('md-mermaid-stage--ready')
      stage.setAttribute('role', 'button')
      stage.setAttribute('tabindex', '0')
      stage.setAttribute('aria-label', 'Diagrama de draw.io: abrir a pantalla completa')
      stage.title = 'Abrir a pantalla completa'
      const show = (): void => {
        openDiagram(asSvg(url, width, height), 'Diagrama de draw.io')
      }
      stage.addEventListener('click', show)
      stage.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        show()
      })
    } catch {
      figure.classList.add('md-mermaid--broken')
      stage.replaceChildren()
      figure.append(element('p', 'md-mermaid-broken', 'El render del diagrama no se pudo leer.'))
    }
  })()

  return figure
}
