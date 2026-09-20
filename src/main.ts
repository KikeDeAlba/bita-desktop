const TABS = ['ahora', 'hoy', 'jira', 'repos'] as const

type Tab = (typeof TABS)[number]

const PENDING: Record<Tab, string> = {
  ahora: 'Los cronómetros vivos',
  hoy: 'Lo trabajado hoy y esta semana',
  jira: 'Lo que falta por registrar',
  repos: 'Proyectos y las rutas que cubren',
}

function isTab(value: string): value is Tab {
  return (TABS as readonly string[]).includes(value)
}

function render(view: HTMLElement, tab: Tab): void {
  view.replaceChildren()
  const placeholder = document.createElement('p')
  placeholder.className = 'placeholder'
  placeholder.textContent = PENDING[tab]
  view.append(placeholder)
}

function wireTabs(view: HTMLElement): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  for (const button of tabs) {
    button.addEventListener('click', () => {
      const name = button.dataset['tab']
      if (name === undefined || !isTab(name)) return
      for (const other of tabs) {
        other.setAttribute('aria-selected', String(other === button))
      }
      render(view, name)
    })
  }
}

const view = document.querySelector<HTMLElement>('#view')

if (view !== null) {
  wireTabs(view)
  render(view, 'ahora')
}
