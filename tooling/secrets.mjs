import path from 'node:path'

const PRIVATE_KEY_EXTENSIONS = new Set(['.key', '.p8', '.p12', '.pem'])
const PRIVATE_KEY_MARKERS = [
  ['BEGIN', 'PRIVATE KEY'].join(' '),
  ['BEGIN', 'RSA PRIVATE KEY'].join(' '),
  ['BEGIN', 'EC PRIVATE KEY'].join(' '),
]

export function containsPrivateKeyMarker(contents) {
  return PRIVATE_KEY_MARKERS.some((marker) => contents.includes(marker))
}

export function isForbiddenPackagedFileName(filePath) {
  const baseName = path.basename(filePath).toLowerCase()
  if (baseName === '.env' || baseName.startsWith('.env.')) return true
  return PRIVATE_KEY_EXTENSIONS.has(path.extname(baseName))
}
