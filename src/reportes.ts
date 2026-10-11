import { element, must } from './dom'

const root = must<HTMLDivElement>('#reportes')
root.replaceChildren(element('p', 'reportes-loading', 'Cargando…'))
