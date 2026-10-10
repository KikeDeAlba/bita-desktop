export type Os = 'macos' | 'windows' | 'linux'

function detect(): Os {
  for (const hint of [navigator.platform, navigator.userAgent]) {
    if (/Win/i.test(hint)) return 'windows'
    if (/Linux|X11|CrOS/i.test(hint)) return 'linux'
    if (/Mac/i.test(hint)) return 'macos'
  }
  return 'linux'
}

export const os: Os = detect()

export const isMac = os === 'macos'

export function modKey(key: string): string {
  return isMac ? `⌘${key}` : `Ctrl+${key}`
}

export const keychain = isMac ? 'el Llavero de macOS' : os === 'windows' ? 'el Administrador de credenciales de Windows' : 'el llavero del sistema'

export const keychainShort = isMac ? 'el Llavero' : os === 'windows' ? 'el Administrador de credenciales' : 'el llavero'
