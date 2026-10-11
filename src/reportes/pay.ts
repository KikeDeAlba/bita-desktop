import { describeProblem } from '../bita.ts'
import { element, iconButton } from '../dom.ts'
import type { App, PayDraft } from './app.ts'
import { money, multiplierLabel, projectLabel } from './model.ts'
import { DEFAULT_PAY, getPay, setPay, type PaySettings, type ReportProject } from './types.ts'
import { button } from './ui.ts'

export function loadPay(app: App): Promise<void> {
  return getPay()
    .then((settings) => {
      app.pay.settings = settings
      app.pay.error = null
    })
    .catch((error: unknown) => {
      app.pay.error = error
    })
}

export function draftFrom(settings: PaySettings): PayDraft {
  return {
    salary: settings.monthlySalary === null ? '' : String(settings.monthlySalary),
    currency: settings.currency,
    hours: String(settings.monthlyHours),
    multiplier: String(settings.multiplier),
    excluded: new Set(settings.excludedProjects),
  }
}

function parseAmount(text: string): number {
  const clean = text.replace(/[\s,$]/g, '')
  return clean === '' ? Number.NaN : Number(clean)
}

export function settingsFrom(draft: PayDraft): PaySettings | string {
  const salaryText = draft.salary.trim()
  const salary = salaryText === '' ? null : parseAmount(salaryText)
  if (salary !== null && (!Number.isFinite(salary) || salary <= 0)) return 'El sueldo mensual debe ser un número mayor que cero'
  const currency = draft.currency.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) return 'La moneda va en código de tres letras, como MXN'
  const hours = parseAmount(draft.hours)
  if (!Number.isFinite(hours) || hours < 1 || hours > 744) return 'Las horas al mes deben estar entre 1 y 744'
  const multiplier = parseAmount(draft.multiplier)
  if (!Number.isFinite(multiplier) || multiplier < 1 || multiplier > 10) return 'El multiplicador debe estar entre 1 y 10'
  return {
    monthlySalary: salary,
    currency,
    monthlyHours: hours,
    multiplier,
    excludedProjects: [...draft.excluded].sort((a, b) => a - b),
  }
}

function rateText(draft: PayDraft): string {
  const parsed = settingsFrom(draft)
  if (typeof parsed === 'string' || parsed.monthlySalary === null) return 'Sin sueldo no se calculan horas extra'
  return `Tu hora: ${money(parsed.monthlySalary / parsed.monthlyHours, parsed.currency)} · pago extra ×1 y ${multiplierLabel(parsed.multiplier)}`
}

export function payPanel(app: App, projects: ReportProject[]): HTMLElement {
  const layer = element('div', 'pay-layer')
  layer.addEventListener('mousedown', (event) => {
    if (event.target === layer && !app.pay.saving) app.closePay()
  })
  const sheet = element('section', 'pay-sheet')
  sheet.setAttribute('role', 'dialog')
  sheet.setAttribute('aria-modal', 'true')
  sheet.setAttribute('aria-labelledby', 'pay-title')
  layer.append(sheet)

  const head = element('div', 'pay-head')
  const title = element('h2', 'pay-title', 'Pago')
  title.id = 'pay-title'
  const close = iconButton('close', 'report-back', 'Cerrar')
  close.dataset['key'] = 'pay-close'
  close.disabled = app.pay.saving
  close.addEventListener('click', () => app.closePay())
  head.append(title, close)
  sheet.append(head, element('p', 'pay-caption', 'Se guarda solo en esta Mac. Las horas extra salen del tiempo estimado de tally, por mes calendario.'))

  const draft = app.pay.draft ?? draftFrom(app.pay.settings ?? DEFAULT_PAY)
  app.pay.draft = draft

  const form = element('form', 'pay-form') as HTMLFormElement
  form.setAttribute('aria-label', 'Pago')
  form.noValidate = true
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    void save(app)
  })

  const rate = element('p', 'pay-rate', rateText(draft))
  rate.setAttribute('aria-live', 'polite')
  const grid = element('div', 'pay-grid')
  const field = (label: string, key: keyof Omit<PayDraft, 'excluded'>, options: { placeholder: string; mode: 'decimal' | 'text'; wide?: boolean }): void => {
    const wrap = element('label', options.wide === true ? 'report-field pay-field--wide' : 'report-field') as HTMLLabelElement
    const input = document.createElement('input')
    input.type = 'text'
    input.inputMode = options.mode
    input.autocomplete = 'off'
    input.spellcheck = false
    input.className = 'report-input'
    input.value = draft[key]
    input.placeholder = options.placeholder
    input.dataset['key'] = `pay-${key}`
    input.disabled = app.pay.saving
    if (key === 'currency') input.maxLength = 3
    input.addEventListener('input', () => {
      draft[key] = input.value
      rate.textContent = rateText(draft)
    })
    wrap.append(element('span', 'report-field-label', label), input)
    grid.append(wrap)
  }
  field('Sueldo mensual', 'salary', { placeholder: 'sin configurar', mode: 'decimal', wide: true })
  field('Moneda', 'currency', { placeholder: 'MXN', mode: 'text' })
  field('Horas al mes', 'hours', { placeholder: '160', mode: 'decimal' })
  field('Multiplicador', 'multiplier', { placeholder: '2', mode: 'decimal' })
  form.append(grid, rate)

  const list = element('fieldset', 'report-fieldset report-fieldset--tight pay-projects') as HTMLFieldSetElement
  list.append(element('legend', 'report-legend-title', 'Proyectos que generan horas extra'))
  const named = projects.filter((project): project is ReportProject & { projectId: number } => project.projectId !== null)
  if (named.length === 0) list.append(element('span', 'report-meta', 'Sin proyectos en el rango del reporte'))
  for (const project of named) {
    const name = projectLabel(project)
    const row = element('div', 'report-switch-row')
    const text = element('span', 'report-switch-text')
    const counts = project.jira && !draft.excluded.has(project.projectId)
    const hintFor = (on: boolean): string => (project.jira ? (on ? 'genera horas extra' : 'no genera horas extra') : 'fuera de Jira')
    const label = element('span', 'report-switch-name', name)
    label.title = name
    const hint = element('span', 'report-switch-hint', hintFor(counts))
    text.append(label, hint)
    const toggle = element('button', 'switch') as HTMLButtonElement
    toggle.type = 'button'
    toggle.setAttribute('role', 'switch')
    toggle.setAttribute('aria-label', `${name} genera horas extra`)
    toggle.setAttribute('aria-checked', String(counts))
    toggle.disabled = !project.jira || app.pay.saving
    toggle.dataset['key'] = `pay-project-${project.projectId}`
    toggle.append(element('span', 'switch-knob'))
    toggle.addEventListener('click', () => {
      const on = draft.excluded.has(project.projectId)
      if (on) draft.excluded.delete(project.projectId)
      else draft.excluded.add(project.projectId)
      toggle.setAttribute('aria-checked', String(on))
      hint.textContent = hintFor(on)
    })
    row.append(text, toggle)
    list.append(row)
  }
  form.append(list)

  const actions = element('div', 'report-export-actions pay-actions')
  if (app.pay.status !== null) {
    const status = element('p', 'report-export-status report-export-status--error', app.pay.status)
    status.setAttribute('role', 'alert')
    actions.append(status)
  }
  const cancel = button('Cancelar', 'ghost-button', () => app.closePay())
  cancel.dataset['key'] = 'pay-cancel'
  cancel.disabled = app.pay.saving
  const submit = element('button', 'primary-button', app.pay.saving ? 'Guardando…' : 'Guardar') as HTMLButtonElement
  submit.type = 'submit'
  submit.dataset['key'] = 'pay-save'
  submit.disabled = app.pay.saving
  actions.append(cancel, submit)
  form.append(actions)
  sheet.append(form)

  sheet.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return
    const focusable = [...sheet.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')]
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (first === undefined || last === undefined) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  })
  return layer
}

async function save(app: App): Promise<void> {
  const draft = app.pay.draft
  if (draft === null || app.pay.saving) return
  const parsed = settingsFrom(draft)
  if (typeof parsed === 'string') {
    app.pay.status = parsed
    app.render()
    document.querySelector<HTMLElement>('[data-key="pay-save"]')?.focus()
    return
  }
  app.pay.saving = true
  app.pay.status = null
  app.render()
  try {
    const saved = await setPay(parsed)
    app.pay.settings = saved ?? parsed
    app.pay.error = null
    app.pay.saving = false
    app.closePay()
    app.reload()
  } catch (error) {
    app.pay.saving = false
    app.pay.status = describeProblem(error).message
    app.render()
    document.querySelector<HTMLElement>('[data-key="pay-save"]')?.focus()
  }
}
