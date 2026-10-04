import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/** Raw 32-byte Ed25519 public key and the publisher key ID Puros displays and pins. */
export function describePublicKey(keyObject) {
  const raw = crypto.createPublicKey(keyObject).export({ format: 'der', type: 'spki' }).subarray(12)
  return { publicKey: raw.toString('base64'), keyId: crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32) }
}

export function isInside(candidate, root) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * Writes a new Ed25519 publisher key (PKCS#8 PEM, mode 0600). Keys must never
 * be committed or packaged, so any location inside `forbiddenRoots` is refused.
 */
export function generateSigningKey(target, { forbiddenRoots = [] } = {}) {
  const resolved = path.resolve(target)
  if (forbiddenRoots.some((root) => isInside(resolved, path.resolve(root)))) {
    throw new Error('Refusing to write a private signing key inside the repository')
  }
  const { privateKey } = crypto.generateKeyPairSync('ed25519')
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 })
  fs.writeFileSync(resolved, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600, flag: 'wx' })
  return { path: resolved, ...describePublicKey(privateKey) }
}
