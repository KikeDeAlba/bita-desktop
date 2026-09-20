export function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  return `${pad(hours)}:${pad(minutes)}:${pad(rest)}`
}

export function human(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (hours === 0) return `${minutes}m`
  return `${hours}h ${minutes}m`
}

export function startedAt(startLocal: string): string {
  return startLocal.slice(11, 16)
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}
