import { os, type Os } from './platform.ts'

const MAC_MODIFIER: Record<string, string> = {
  ctrl: '⌃',
  control: '⌃',
  alt: '⌥',
  option: '⌥',
  shift: '⇧',
  cmd: '⌘',
  command: '⌘',
  super: '⌘',
  meta: '⌘',
  cmdorctrl: '⌘',
  commandorcontrol: '⌘',
}

const PC_MODIFIER: Record<string, string> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  cmd: 'Super',
  command: 'Super',
  super: 'Super',
  meta: 'Super',
  cmdorctrl: 'Ctrl',
  commandorcontrol: 'Ctrl',
}

const KEY_LABEL: Record<string, string> = {
  space: 'Espacio',
  escape: 'Esc',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
}

const MAC_KEY: Record<string, string> = {
  enter: '↩',
  return: '↩',
  tab: '⇥',
  backspace: '⌫',
}

const PC_KEY: Record<string, string> = {
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  backspace: 'Retroceso',
}

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Cmd']

export function shortcutLabel(accelerator: string, platform: Os = os): string {
  if (accelerator.trim().length === 0) return 'sin atajo'
  const mac = platform === 'macos'
  const glyphs = mac ? MAC_MODIFIER : { ...PC_MODIFIER, ...(platform === 'windows' ? { cmd: 'Win', command: 'Win', super: 'Win', meta: 'Win' } : {}) }
  const keys = mac ? MAC_KEY : PC_KEY
  const parts = accelerator.split('+').map((part) => part.trim()).filter((part) => part.length > 0)
  const key = parts.pop() ?? ''
  const modifiers = parts.map((part) => glyphs[part.toLowerCase()] ?? part)
  const lowered = key.toLowerCase()
  const name = KEY_LABEL[lowered] ?? keys[lowered] ?? (lowered.startsWith('key') && key.length === 4 ? key.slice(3) : key.length === 1 ? key.toUpperCase() : key)
  return mac ? `${modifiers.join('')}${name}` : [...modifiers, name].join('+')
}

function keyName(event: KeyboardEvent): string | null {
  const code = event.code
  if (code === 'Space') return 'Space'
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1[0-9])$/.test(code)) return code
  if (['Enter', 'Tab', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) return code
  return null
}

export function acceleratorFrom(event: KeyboardEvent): string | null {
  const key = keyName(event)
  if (key === null) return null
  const held = new Set<string>()
  if (event.ctrlKey) held.add('Ctrl')
  if (event.altKey) held.add('Alt')
  if (event.shiftKey) held.add('Shift')
  if (event.metaKey) held.add('Cmd')
  if (held.size === 0 || (held.size === 1 && held.has('Shift'))) return null
  return [...MODIFIER_ORDER.filter((name) => held.has(name)), key].join('+')
}
