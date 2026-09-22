const BANNED_TAGS = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'use'])

export function adoptSvg(source: string): SVGElement | null {
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml')
  if (parsed.getElementsByTagName('parsererror').length > 0) return null

  const root = parsed.documentElement
  if (root.tagName.toLowerCase() !== 'svg') return null

  scrub(root)
  return document.importNode(root, true) as unknown as SVGElement
}

function scrub(node: Element): void {
  for (const child of [...node.children]) {
    if (BANNED_TAGS.has(child.tagName.toLowerCase())) {
      child.remove()
      continue
    }
    scrub(child)
  }

  for (const attribute of [...node.attributes]) {
    const name = attribute.name.toLowerCase()
    if (name.startsWith('on')) {
      node.removeAttribute(attribute.name)
      continue
    }
    if (name === 'href' || name === 'xlink:href') {
      if (!attribute.value.startsWith('#')) node.removeAttribute(attribute.name)
    }
  }
}
