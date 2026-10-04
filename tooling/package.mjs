import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import zlib from 'node:zlib'
import { builtinModules } from 'node:module'
import { fileURLToPath } from 'node:url'
import { isPathInside, runBuildSteps } from './manifest.mjs'
import { containsPrivateKeyMarker, isForbiddenPackagedFileName } from './secrets.mjs'
import { describePublicKey, isInside } from './keygen.mjs'

// Providers import the API as `puros-provider-sdk`; the packer bundles the
// source of the SDK that runs it, so a package never depends on node_modules.
const SDK_SOURCE_ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url))

export const PACKAGE_FORMAT = 'puros-provider-package'
export const PACKAGE_FORMAT_VERSION = 1
export const PACKAGE_DESCRIPTOR_PATH = 'puros-provider.json'
export const PACKAGE_MANIFEST_PATH = 'provider.manifest.json'
export const PACKAGE_ENTRY_PATH = 'dist/index.mjs'
export const PACKAGE_SIGNATURE_PATH = 'puros-provider.sig'
// The stage-2 importer must enforce limits at least this strict; the packer
// refuses to produce an archive that a conforming importer would reject.
export const PACKAGE_LIMITS = Object.freeze({
  maxEntries: 4_096,
  maxPathBytes: 240,
  maxPathDepth: 16,
  maxFileBytes: 256 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
})
const RESERVED_PATHS = new Set([PACKAGE_DESCRIPTOR_PATH, PACKAGE_SIGNATURE_PATH, PACKAGE_MANIFEST_PATH])
const RESERVED_PREFIXES = ['dist/']
const MODE_FILE = 0o644
const MODE_EXECUTABLE = 0o755
// 1980-01-01 00:00:00, the earliest DOS timestamp, keeps archives byte-stable.
const DOS_TIME = 0
const DOS_DATE = (0 << 9) | (1 << 5) | 1
const ZIP_UTF8_FLAG = 0x0800
const ZIP_VERSION = 20
const ZIP_MADE_BY_UNIX = (3 << 8) | ZIP_VERSION
const BUILTIN_SPECIFIERS = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)])
const MIN_SECRET_VALUE_LENGTH = 8

function fail(provider, message) {
  throw new Error(`Provider package ${provider.manifest.id}: ${message}`)
}

export function validatePackagePath(value) {
  if (typeof value !== 'string' || value.length === 0) return 'empty path'
  if (value !== value.normalize('NFC')) return 'path is not NFC-normalized'
  if (Buffer.byteLength(value, 'utf8') > PACKAGE_LIMITS.maxPathBytes) return 'path is too long'
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\:]/.test(value)) return 'path contains a control character, backslash or colon'
  const segments = value.split('/')
  if (segments.length > PACKAGE_LIMITS.maxPathDepth) return 'path is too deep'
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return 'path has an empty, "." or ".." segment'
  return null
}

function globToRegExp(pattern) {
  if (pattern.startsWith('!')) throw new Error(`Negated resource filters are not supported in provider packages: ${pattern}`)
  let source = ''
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]
    if (character === '*' && pattern[index + 1] === '*') {
      source += '.*'
      index += 1
    } else if (character === '*') source += '[^/]*'
    else if (character === '?') source += '[^/]'
    else source += character.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${source}$`)
}

function listRegularFiles(provider, directory, relative = '') {
  const results = []
  for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isSymbolicLink()) fail(provider, `resource ${childRelative} is a symbolic link; packages contain regular files only`)
    if (entry.isDirectory()) results.push(...listRegularFiles(provider, directory, childRelative))
    else if (entry.isFile()) results.push(childRelative)
    else fail(provider, `resource ${childRelative} is not a regular file`)
  }
  return results
}

/** Maps manifest `build.extraResources` into package-relative files (the provider's resource root). */
export function collectDeclaredResources(provider) {
  const { root, manifest } = provider
  const realRoot = fs.realpathSync(root)
  const prefix = `providers/${manifest.id}/`
  const files = new Map()
  const add = (packagePath, sourcePath) => {
    const problem = validatePackagePath(packagePath)
    if (problem) fail(provider, `invalid resource path ${JSON.stringify(packagePath)}: ${problem}`)
    if (RESERVED_PATHS.has(packagePath) || RESERVED_PREFIXES.some((reserved) => packagePath.startsWith(reserved))) {
      fail(provider, `resource ${packagePath} collides with a reserved package path`)
    }
    if (files.has(packagePath)) fail(provider, `two declared resources map to ${packagePath}`)
    files.set(packagePath, sourcePath)
  }
  for (const resource of manifest.build?.extraResources ?? []) {
    if (!resource.to.startsWith(prefix) || resource.to.length === prefix.length) {
      fail(provider, `resource destination ${resource.to} must be inside ${prefix}`)
    }
    const destination = resource.to.slice(prefix.length).replace(/\/+$/, '')
    const source = path.resolve(root, resource.from)
    if (!isPathInside(source, root)) fail(provider, `resource source ${resource.from} escapes the provider directory`)
    if (!fs.existsSync(source)) fail(provider, `declared resource ${resource.from} does not exist; run the provider build first`)
    const stat = fs.lstatSync(source)
    if (stat.isSymbolicLink()) fail(provider, `resource ${resource.from} is a symbolic link; packages contain regular files only`)
    if (!isPathInside(fs.realpathSync(source), realRoot)) fail(provider, `resource source ${resource.from} escapes the provider directory`)
    if (stat.isFile()) {
      add(destination, source)
      continue
    }
    if (!stat.isDirectory()) fail(provider, `resource ${resource.from} is not a regular file or directory`)
    const filters = resource.filter?.map(globToRegExp)
    for (const relative of listRegularFiles(provider, source)) {
      if (filters && !filters.some((filter) => filter.test(relative))) continue
      add(`${destination}/${relative}`, path.join(source, relative))
    }
  }
  return files
}

/** Returns the Mach-O architectures of an executable, or null when the bytes are not Mach-O. */
export function detectMachOArchitectures(buffer) {
  const cpuName = (cpuType) => ({ 0x01000007: 'x86_64', 0x0100000c: 'arm64' })[cpuType >>> 0] ?? `cpu-${(cpuType >>> 0).toString(16)}`
  if (buffer.length < 8) return null
  const magicBE = buffer.readUInt32BE(0)
  if (magicBE === 0xcafebabe || magicBE === 0xcafebabf) {
    const count = buffer.readUInt32BE(4)
    const stride = magicBE === 0xcafebabf ? 32 : 20
    if (count < 1 || count > 16 || buffer.length < 8 + count * stride) return null
    const architectures = []
    for (let index = 0; index < count; index += 1) architectures.push(cpuName(buffer.readUInt32BE(8 + index * stride)))
    return [...new Set(architectures)].sort()
  }
  const magicLE = buffer.readUInt32LE(0)
  if (magicLE === 0xfeedfacf || magicLE === 0xfeedface) return [cpuName(buffer.readUInt32LE(4))]
  return null
}

/** Lists dylib load paths of a thin or fat Mach-O (first slice), or null when not Mach-O 64. */
export function listMachODylibs(buffer) {
  let base = 0
  if (buffer.length >= 28 && [0xcafebabe, 0xcafebabf].includes(buffer.readUInt32BE(0))) {
    base = buffer.readUInt32BE(0) === 0xcafebabf ? Number(buffer.readBigUInt64BE(16)) : buffer.readUInt32BE(16)
  }
  if (buffer.length < base + 32 || buffer.readUInt32LE(base) !== 0xfeedfacf) return null
  const commandCount = buffer.readUInt32LE(base + 16)
  const dylibCommands = new Set([0xc, 0x80000018, 0x8000001f, 0x80000023])
  const libraries = []
  let cursor = base + 32
  for (let index = 0; index < commandCount && cursor + 8 <= buffer.length; index += 1) {
    const command = buffer.readUInt32LE(cursor)
    const size = buffer.readUInt32LE(cursor + 4)
    if (size < 8) return null
    if (dylibCommands.has(command) && cursor + 12 <= buffer.length) {
      const start = cursor + buffer.readUInt32LE(cursor + 8)
      const end = buffer.indexOf(0, start)
      if (end > start && end <= cursor + size) libraries.push(buffer.toString('utf8', start, end))
    }
    cursor += size
  }
  return libraries
}

/** Absolute dylib paths outside the OS that a clean Mac will not have. */
export function findNonPortableDylibs(buffer) {
  return (listMachODylibs(buffer) ?? []).filter((library) => library.startsWith('/')
    && !library.startsWith('/usr/lib/') && !library.startsWith('/System/'))
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

/**
 * Writes a deterministic ZIP: fixed order, DOS epoch timestamps, UNIX modes,
 * UTF-8 names, no extra fields, no directory entries, no ZIP64.
 */
export function createDeterministicZip(entries) {
  if (entries.length > PACKAGE_LIMITS.maxEntries) throw new Error('Provider package has too many entries')
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8')
    const crc = zlib.crc32(entry.data) >>> 0
    const deflated = zlib.deflateRawSync(entry.data, { level: 9 })
    const useDeflate = deflated.length < entry.data.length
    const payload = useDeflate ? deflated : entry.data
    const method = useDeflate ? 8 : 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(ZIP_VERSION, 4)
    local.writeUInt16LE(ZIP_UTF8_FLAG, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(ZIP_MADE_BY_UNIX, 4)
    central.writeUInt16LE(ZIP_VERSION, 6)
    central.writeUInt16LE(ZIP_UTF8_FLAG, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(((0o100000 | entry.mode) << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    localParts.push(local, name, payload)
    centralParts.push(central, name)
    offset += local.length + name.length + payload.length
    if (offset > 0xffffffff) throw new Error('Provider package exceeds the non-ZIP64 size limit')
  }
  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, centralDirectory, end])
}

async function compileProviderEntry(provider, outputDirectory, envDirectory, buildRoot) {
  // Rolldown region comments are relative to the working directory, so a fixed
  // cwd keeps the bundle independent of where the checkout lives.
  if (path.resolve(process.cwd()) !== buildRoot) throw new Error(`Provider packages must be built from ${buildRoot}`)
  const { build } = await import('vite')
  await build({
    configFile: false,
    root: provider.root,
    logLevel: 'warn',
    // An empty env directory and an unmatched prefix keep dotenv/VITE_* values
    // out of the compiled provider code.
    envDir: envDirectory,
    envPrefix: '__PUROS_PROVIDER_PACKAGE_NO_ENV__',
    resolve: { alias: [{ find: /^puros-provider-sdk$/, replacement: SDK_SOURCE_ENTRY }] },
    build: {
      ssr: path.join(provider.root, 'src', 'index.ts'),
      outDir: outputDirectory,
      emptyOutDir: true,
      minify: false,
      sourcemap: false,
      copyPublicDir: false,
      reportCompressedSize: false,
      target: 'node22',
      rollupOptions: {
        external: (specifier) => BUILTIN_SPECIFIERS.has(specifier),
        output: { format: 'es', entryFileNames: 'index.mjs', codeSplitting: false },
      },
    },
    ssr: { noExternal: true, target: 'node' },
  })
  const files = fs.readdirSync(outputDirectory)
  if (files.length !== 1 || files[0] !== 'index.mjs') fail(provider, `compiled output must be a single index.mjs, found ${files.join(', ')}`)
  const code = fs.readFileSync(path.join(outputDirectory, 'index.mjs'))
  const source = code.toString('utf8')
  const importSpecifiers = [...source.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g)]
    .map((match) => match[1] ?? match[2] ?? match[3])
  const external = importSpecifiers.filter((specifier) => !BUILTIN_SPECIFIERS.has(specifier))
  if (external.length > 0) fail(provider, `compiled entry must import only Node.js built-ins, found ${[...new Set(external)].join(', ')}`)
  if (source.includes(buildRoot) || source.includes(os.homedir())) fail(provider, 'compiled entry contains an absolute build-machine path')
  return code
}

function findSecretIssues(provider, entries) {
  const declaredValues = (provider.manifest.permissions?.runtimeEnvironment ?? [])
    .map((name) => [name, process.env[name]])
    .filter(([, value]) => typeof value === 'string' && value.length >= MIN_SECRET_VALUE_LENGTH)
  const issues = []
  for (const entry of entries) {
    if (isForbiddenPackagedFileName(entry.path)) issues.push(`${entry.path}: forbidden secret filename`)
    if (containsPrivateKeyMarker(entry.data)) issues.push(`${entry.path}: private-key marker`)
    for (const [name, value] of declaredValues) {
      // Never print the value; the variable name is enough to act on.
      if (entry.data.includes(value)) issues.push(`${entry.path}: contains the build machine's ${name} value`)
    }
  }
  return issues
}

function describePlatform(provider, entriesByPath) {
  const binaries = provider.manifest.build?.binaries ?? []
  if (binaries.length === 0) return null
  const prefix = `providers/${provider.manifest.id}/`
  let architectures = null
  for (const binary of binaries) {
    if (!binary.startsWith(prefix)) fail(provider, `binary ${binary} must be inside ${prefix}`)
    const entry = entriesByPath.get(binary.slice(prefix.length))
    if (!entry) fail(provider, `declared binary ${binary} is not among the packaged resources`)
    if (entry.mode !== MODE_EXECUTABLE) fail(provider, `declared binary ${binary} is not executable`)
    const found = detectMachOArchitectures(entry.data)
    if (!found) fail(provider, `declared binary ${binary} is not a Mach-O executable`)
    architectures = architectures ? architectures.filter((arch) => found.includes(arch)) : found
  }
  if (architectures.length === 0) fail(provider, 'declared binaries share no common CPU architecture')
  return { os: 'darwin', arch: architectures }
}

function assertPortableBinaries(provider, entriesByPath) {
  const prefix = `providers/${provider.manifest.id}/`
  for (const binary of provider.manifest.build?.binaries ?? []) {
    const libraries = findNonPortableDylibs(entriesByPath.get(binary.slice(prefix.length)).data)
    if (libraries.length > 0) {
      fail(provider, `${binary.slice(prefix.length)} links ${libraries.length} dylib(s) outside macOS (e.g. ${libraries[0]}); packaged binaries must be self-contained`)
    }
  }
}

function packageFileName(manifest) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(manifest.version)) {
    throw new Error(`Provider ${manifest.id} version ${JSON.stringify(manifest.version)} cannot be used in a package file name`)
  }
  return `puros-provider-${manifest.id}-${manifest.version}.zip`
}

function writeFileAtomically(filePath, data) {
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`
  fs.writeFileSync(temporary, data, { mode: 0o644 })
  fs.renameSync(temporary, filePath)
}

/**
 * Detached Ed25519 signature over the exact descriptor bytes. Ed25519 is
 * deterministic, so signed packages stay byte-reproducible. The key must not
 * live inside any of `forbiddenRoots` (the checkouts being packaged).
 */
export function signDescriptor(descriptorBytes, signingKeyPath, { forbiddenRoots = [process.cwd()] } = {}) {
  const resolved = path.resolve(signingKeyPath)
  if (forbiddenRoots.some((root) => isInside(resolved, path.resolve(root)))) {
    throw new Error('The provider signing key must live outside the repository')
  }
  const privateKey = crypto.createPrivateKey(fs.readFileSync(resolved))
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('The provider signing key must be an Ed25519 private key')
  const { publicKey } = describePublicKey(privateKey)
  return Buffer.from(`${JSON.stringify({
    format: 'puros-provider-signature',
    formatVersion: 1,
    algorithm: 'ed25519',
    publicKey,
    signature: crypto.sign(null, descriptorBytes, privateKey).toString('base64'),
  }, null, 2)}\n`)
}

/**
 * Compiles one provider and writes `<out>/puros-provider-<id>-<version>.zip`
 * plus a `.sha256` sidecar. Identical inputs and toolchain yield identical bytes.
 * `buildRoot` is the required working directory (the provider root by default).
 */
export async function packProvider(provider, {
  skipBuild = false,
  outputRoot = path.join(provider.root, 'release'),
  signingKeyPath = null,
  buildRoot = provider.root,
} = {}) {
  const resolvedBuildRoot = path.resolve(buildRoot)
  if (!skipBuild) runBuildSteps([provider])
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), `puros-provider-package-${provider.manifest.id}-`))
  try {
    const envDirectory = path.join(workRoot, 'env')
    fs.mkdirSync(envDirectory)
    const code = await compileProviderEntry(provider, path.join(workRoot, 'dist'), envDirectory, resolvedBuildRoot)
    const entries = [
      { path: PACKAGE_MANIFEST_PATH, data: Buffer.from(`${JSON.stringify(provider.manifest, null, 2)}\n`), mode: MODE_FILE },
      { path: PACKAGE_ENTRY_PATH, data: code, mode: MODE_FILE },
    ]
    for (const [packagePath, sourcePath] of collectDeclaredResources(provider)) {
      const stat = fs.statSync(sourcePath)
      if (stat.size > PACKAGE_LIMITS.maxFileBytes) fail(provider, `${packagePath} exceeds the per-file size limit`)
      entries.push({ path: packagePath, data: fs.readFileSync(sourcePath), mode: (stat.mode & 0o111) !== 0 ? MODE_EXECUTABLE : MODE_FILE })
    }
    entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
    const folded = new Set()
    for (const entry of entries) {
      // APFS is case-insensitive by default; two names differing only by case would overwrite each other.
      const key = entry.path.normalize('NFC').toLowerCase()
      if (folded.has(key)) fail(provider, `package paths collide case-insensitively at ${entry.path}`)
      folded.add(key)
    }
    const totalBytes = entries.reduce((sum, entry) => sum + entry.data.length, 0)
    if (totalBytes > PACKAGE_LIMITS.maxTotalBytes) fail(provider, 'package exceeds the total uncompressed size limit')

    const entriesByPath = new Map(entries.map((entry) => [entry.path, entry]))
    if (!entriesByPath.has(provider.manifest.icon)) fail(provider, `manifest icon ${provider.manifest.icon} is not among the packaged resources`)
    for (const helper of provider.manifest.permissions?.helpers ?? []) {
      const entry = entriesByPath.get(helper.executable)
      if (!entry) fail(provider, `helper ${helper.id} executable ${helper.executable} is not among the packaged resources`)
      if (entry.mode !== MODE_EXECUTABLE) fail(provider, `helper ${helper.id} executable ${helper.executable} is not executable`)
    }
    const platform = describePlatform(provider, entriesByPath)
    if (platform) assertPortableBinaries(provider, entriesByPath)
    const secretIssues = findSecretIssues(provider, entries)
    if (secretIssues.length > 0) fail(provider, `secret material must not be packaged:\n  ${secretIssues.join('\n  ')}`)

    const { version: viteVersion, rolldownVersion } = await import('vite')
    const descriptor = {
      format: PACKAGE_FORMAT,
      formatVersion: PACKAGE_FORMAT_VERSION,
      provider: { id: provider.manifest.id, version: provider.manifest.version, apiVersion: provider.manifest.apiVersion },
      manifest: PACKAGE_MANIFEST_PATH,
      entry: PACKAGE_ENTRY_PATH,
      platform,
      toolchain: { vite: viteVersion, rolldown: rolldownVersion ?? null, zlib: process.versions.zlib },
      files: entries.map((entry) => ({
        path: entry.path,
        size: entry.data.length,
        sha256: sha256(entry.data),
        mode: entry.mode === MODE_EXECUTABLE ? '0755' : '0644',
      })),
    }
    const descriptorBytes = Buffer.from(`${JSON.stringify(descriptor, null, 2)}\n`)
    const archive = createDeterministicZip([
      { path: PACKAGE_DESCRIPTOR_PATH, data: descriptorBytes, mode: MODE_FILE },
      ...(signingKeyPath ? [{ path: PACKAGE_SIGNATURE_PATH, data: signDescriptor(descriptorBytes, signingKeyPath, { forbiddenRoots: [resolvedBuildRoot, provider.root] }), mode: MODE_FILE }] : []),
      ...entries,
    ])
    fs.mkdirSync(outputRoot, { recursive: true })
    const zipPath = path.join(outputRoot, packageFileName(provider.manifest))
    const digest = sha256(archive)
    writeFileAtomically(zipPath, archive)
    writeFileAtomically(`${zipPath}.sha256`, `${digest}  ${path.basename(zipPath)}\n`)
    return { zipPath, sha256: digest, size: archive.length, descriptor, signed: Boolean(signingKeyPath) }
  } finally {
    fs.rmSync(workRoot, { recursive: true, force: true })
  }
}
