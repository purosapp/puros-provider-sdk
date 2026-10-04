import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** The `puros-provider` CLI that build steps call back into (for example `ffmpeg --install=`). */
export const PROVIDER_CLI_PATH = fileURLToPath(new URL('../bin/puros-provider.mjs', import.meta.url))

const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/
const CAPABILITIES = new Set([
  'auth', 'catalog.search', 'catalog.entities', 'catalog.home', 'library.sync', 'playlists',
  'playback.resolve', 'playback.prefetch', 'playback.progressive', 'quality.tiers',
  'metadata.artwork', 'metadata.bio', 'metadata.credits',
])

function isContainedRelativePath(value) {
  return typeof value === 'string' && value.length > 0 && !path.isAbsolute(value) && !value.split(/[\\/]/).includes('..')
}

export function isPathInside(candidate, root) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

/**
 * Throws when a manifest breaks the build-time rules. `directoryName` is the
 * checkout directory when the host repository requires it to match the ID;
 * standalone provider repositories pass null.
 */
export function validateManifest(manifest, directoryName = null) {
  const errors = []
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) errors.push('manifest must be an object')
  if (manifest.schemaVersion !== 1 || manifest.apiVersion !== 1) errors.push('schemaVersion and apiVersion must be 1')
  if (typeof manifest.id !== 'string' || !PROVIDER_ID_PATTERN.test(manifest.id) || ['local', 'm3u'].includes(manifest.id)) errors.push('invalid provider ID')
  if (directoryName !== null && manifest.id !== directoryName && !(directoryName === '_example' && manifest.id === 'example')) errors.push('directory name must match provider ID')
  if (typeof manifest.version !== 'string' || manifest.version.length < 1 || manifest.version.length > 64) errors.push('invalid version')
  if (typeof manifest.displayName !== 'string' || manifest.displayName.length < 1) errors.push('invalid displayName')
  if (!isContainedRelativePath(manifest.icon)) errors.push('invalid icon path')
  if (!/^#[0-9a-f]{6}$/i.test(manifest.brandColor ?? '')) errors.push('invalid brandColor')
  if (!Number.isInteger(manifest.defaultPriority)) errors.push('invalid defaultPriority')
  if (!Array.isArray(manifest.capabilities) || new Set(manifest.capabilities).size !== manifest.capabilities.length || manifest.capabilities.some((item) => !CAPABILITIES.has(item))) {
    errors.push('invalid capabilities')
  }
  if (manifest.librarySyncMode !== undefined && (
    manifest.librarySyncMode !== 'host-mirror' || !manifest.capabilities?.includes('library.sync')
  )) errors.push('invalid librarySyncMode')
  if (manifest.playbackTimeoutMs !== undefined && (
    !Number.isInteger(manifest.playbackTimeoutMs)
    || manifest.playbackTimeoutMs < 120_000
    || manifest.playbackTimeoutMs > 1_800_000
    || !manifest.capabilities?.includes('playback.resolve')
  )) errors.push('invalid playbackTimeoutMs')
  if (manifest.permissions?.runtimeEnvironment !== undefined && (
    !Array.isArray(manifest.permissions.runtimeEnvironment)
    || new Set(manifest.permissions.runtimeEnvironment).size !== manifest.permissions.runtimeEnvironment.length
    || manifest.permissions.runtimeEnvironment.some((name) => typeof name !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(name) || !name.startsWith(`${manifest.id.replace(/-/g, '_').toUpperCase()}_`))
  )) errors.push('invalid runtime environment declaration')
  for (const [index, step] of (manifest.build?.steps ?? []).entries()) {
    if (!isContainedRelativePath(step.command) || (step.cwd !== undefined && !isContainedRelativePath(step.cwd))) errors.push(`invalid build step ${index}`)
  }
  for (const [index, resource] of (manifest.build?.extraResources ?? []).entries()) {
    if (!isContainedRelativePath(resource.from) || !isContainedRelativePath(resource.to)) errors.push(`invalid build resource ${index}`)
  }
  for (const [index, helper] of (manifest.permissions?.helpers ?? []).entries()) {
    if (!helper || typeof helper !== 'object' || !isContainedRelativePath(helper.executable)) {
      errors.push(`invalid helper ${index}`)
      continue
    }
    if (helper.processPriority !== undefined && helper.processPriority !== 'below-normal') {
      errors.push(`invalid helper process priority ${index}`)
    }
    if (helper.argumentTemplate !== undefined) {
      const template = helper.argumentTemplate
      const slots = Array.isArray(template) ? template.filter((item) => item && typeof item === 'object').map((item) => item.cachePath) : []
      if (helper.allowedArguments !== undefined || !Array.isArray(template) || template.length < 2 || template.length > 32
        || template.some((item) => !(typeof item === 'string' && item.length > 0 && item.length <= 100)
          && !(item && typeof item === 'object' && Object.keys(item).length === 1 && ['input', 'output'].includes(item.cachePath)))
        || slots.filter((slot) => slot === 'input').length !== 1
        || slots.filter((slot) => slot === 'output').length > 1) errors.push(`invalid helper argument template ${index}`)
    }
  }
  if (errors.length > 0) throw new Error(`${directoryName ?? manifest?.id ?? 'provider'}/provider.manifest.json: ${errors.join('; ')}`)
}

/** Reads and validates the provider rooted at `root` (the directory holding provider.manifest.json). */
export function loadProvider(root, { directoryName = null } = {}) {
  const resolvedRoot = path.resolve(root)
  const manifestPath = path.join(resolvedRoot, 'provider.manifest.json')
  if (!fs.existsSync(manifestPath)) throw new Error(`No provider.manifest.json in ${resolvedRoot}`)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  validateManifest(manifest, directoryName)
  if (!fs.existsSync(path.join(resolvedRoot, 'src', 'index.ts'))) throw new Error(`Provider ${manifest.id} is missing src/index.ts`)
  return { directoryName: directoryName ?? path.basename(resolvedRoot), root: resolvedRoot, manifest }
}

/**
 * Runs each provider's declared build steps for this platform. Steps receive
 * PUROS_PROVIDER_ROOT and PUROS_PROVIDER_CLI, so a helper build can install the
 * pinned ffmpeg with `node "$PUROS_PROVIDER_CLI" ffmpeg --install=<dir>`.
 */
export function runBuildSteps(providers) {
  for (const provider of providers) {
    for (const step of provider.manifest.build?.steps ?? []) {
      if (step.platforms && !step.platforms.includes(process.platform)) continue
      const command = path.resolve(provider.root, step.command)
      const cwd = path.resolve(provider.root, step.cwd ?? '.')
      if (!isPathInside(command, provider.root) || !isPathInside(cwd, provider.root)) throw new Error(`Provider ${provider.manifest.id} build path escaped its root`)
      const result = spawnSync(command, step.args ?? [], {
        cwd,
        stdio: 'inherit',
        shell: false,
        env: { ...process.env, PUROS_PROVIDER_ROOT: provider.root, PUROS_PROVIDER_CLI: PROVIDER_CLI_PATH },
      })
      if (result.status !== 0) throw new Error(`Provider ${provider.manifest.id} build step failed with exit code ${result.status}`)
    }
  }
}
