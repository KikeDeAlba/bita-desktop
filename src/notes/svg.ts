const BANNED_TAGS = new Set(['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base'])

const LABEL_TAGS = new Set([
  'div',
  'span',
  'p',
  'br',
  'em',
  'strong',
  'b',
  'i',
  'u',
  'code',
  'sub',
  'sup',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
])

const SVG_NS = 'http://www.w3.org/2000/svg'

function parseAsXml(source: string): Element | null {
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml')
  if (parsed.getElementsByTagName('parsererror').length > 0) return null
  return parsed.documentElement
}

function parseAsHtml(source: string): Element | null {
  const parsed = new DOMParser().parseFromString(`<!doctype html><body>${source}</body>`, 'text/html')
  const root = parsed.body.firstElementChild
  if (root === null || parsed.body.children.length !== 1) return null
  return root
}

export function adoptSvg(source: string): SVGElement | null {
  const root = parseAsXml(source) ?? parseAsHtml(source)
  if (root === null) return null
  if (root.tagName.toLowerCase() !== 'svg' || root.namespaceURI !== SVG_NS) return null

  scrub(root)
  return document.importNode(root, true) as unknown as SVGElement
}

function scrub(node: Element): void {
  for (const child of [...node.children]) {
    const tag = child.tagName.toLowerCase()
    if (BANNED_TAGS.has(tag)) {
      child.remove()
      continue
    }
    if (tag === 'foreignobject') {
      scrubLabel(child)
      continue
    }
    scrub(child)
  }
  strip(node)
}

function scrubLabel(node: Element): void {
  strip(node)

  for (const child of [...node.children]) {
    const tag = child.tagName.toLowerCase()
    if (BANNED_TAGS.has(tag)) {
      child.remove()
      continue
    }
    if (!LABEL_TAGS.has(tag)) {
      const inner = [...child.childNodes]
      child.replaceWith(...inner)
      for (const moved of inner) {
        if (moved.nodeType === Node.ELEMENT_NODE) scrubLabel(moved as Element)
      }
      continue
    }
    scrubLabel(child)
  }
}

function strip(node: Element): void {
  for (const attribute of [...node.attributes]) {
    const name = attribute.name.toLowerCase()
    if (name.startsWith('on')) {
      node.removeAttribute(attribute.name)
      continue
    }
    if (name === 'src' || name === 'srcset' || name === 'formaction') {
      node.removeAttribute(attribute.name)
      continue
    }
    if ((name === 'href' || name === 'xlink:href') && !attribute.value.startsWith('#')) {
      node.removeAttribute(attribute.name)
    }
  }
}
