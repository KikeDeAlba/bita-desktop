import { must } from './dom.ts'
import { notesTakeFocus } from './bita.ts'

const rail = must<HTMLElement>('#rail')
const reader = must<HTMLElement>('#reader')

async function start(): Promise<void> {
  rail.textContent = 'Notas'
  const focus = await notesTakeFocus()
  reader.textContent = focus === null ? 'Sin nota seleccionada' : `Nota de la entrada #${focus}`
}

void start()
