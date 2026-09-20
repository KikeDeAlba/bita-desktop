import { describeProblem, installCli, quit, type Check, type Report } from './bita.ts'
import { element } from './dom.ts'

const MARKS: Record<Check['health'], string> = {
  ok: '✓',
  warn: '·',
  fail: '✕',
}

function checkRow(check: Check): HTMLElement {
  const row = element('div', `check check--${check.health}`)

  const mark = element('span', 'check-mark', MARKS[check.health])
  const body = element('div', 'check-body')
  body.append(element('p', 'check-title', check.title))
  for (const line of check.detail.split('\n')) {
    body.append(element('p', 'check-detail', line))
  }
  if (check.note !== null) body.append(element('p', 'check-note', check.note))

  row.append(mark, body)
  return row
}

export function renderSettings(
  view: HTMLElement,
  report: Report,
  onDone: () => void,
  onReload: () => void,
): void {
  view.replaceChildren()

  const head = element('div', 'settings-head')
  head.append(
    element(
      'p',
      'settings-title',
      report.blocked ? 'Falta algo para poder medir' : 'Todo listo',
    ),
  )
  head.append(
    element(
      'p',
      'settings-note',
      report.blocked
        ? 'La app habla con el CLI de bita. Esto es lo que ha encontrado.'
        : 'La app habla con el CLI de bita. Esto es lo que está usando.',
    ),
  )
  view.append(head)

  const checks = element('div', 'checks')
  for (const check of report.checks) checks.append(checkRow(check))
  view.append(checks)

  if (report.canInstall) {
    const install = element('button', 'primary-button wide', 'Instalarlo de verdad') as HTMLButtonElement
    install.type = 'button'
    const log = element('pre', 'install-log')
    log.hidden = true

    install.addEventListener('click', () => {
      install.disabled = true
      install.textContent = 'Instalando…'
      void installCli()
        .then((output) => {
          log.hidden = false
          log.textContent = output
          install.textContent = 'Instalado'
          onReload()
        })
        .catch((error: unknown) => {
          log.hidden = false
          log.textContent = describeProblem(error).message
          install.disabled = false
          install.textContent = 'Reintentar'
        })
    })

    view.append(install, log)
  }

  const close = element('button', 'ghost-button wide', 'Volver') as HTMLButtonElement
  close.type = 'button'
  close.addEventListener('click', onDone)
  view.append(close)

  const leave = element('div', 'leave')
  leave.append(
    element('p', 'leave-note', 'bita vive en la barra: no tiene ventana ni icono en el Dock.'),
  )
  const stop = element('button', 'danger-button wide', 'Salir de bita') as HTMLButtonElement
  stop.type = 'button'
  stop.addEventListener('click', () => {
    void quit()
  })
  leave.append(stop)
  view.append(leave)
}
