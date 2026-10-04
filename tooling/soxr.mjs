import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

// Pinned source. The SHA-256 was cross-checked on 2026-10-01 against the
// SourceForge download and Homebrew's libsoxr formula API.
export const SOXR_VERSION = '0.1.3'
const SOXR_SOURCE_URL = `https://downloads.sourceforge.net/project/soxr/soxr-${SOXR_VERSION}-Source.tar.xz`
const SOXR_SOURCE_SHA256 = 'b111c15fdc8c029989330ff559184198c161100a59312f5dc19ddeb9b5a15889'
const MACOS_MINIMUM = '12.0'
const ARCHS = ['arm64', 'x86_64']
// The addon loads libsoxr as a separate LGPL-2.1 dylib next to it; ffmpeg links the static archive.
export const SOXR_DYLIB_NAME = 'libsoxr.0.dylib'

const CMAKE_FLAGS = [
  '-DCMAKE_BUILD_TYPE=Release',
  `-DCMAKE_OSX_DEPLOYMENT_TARGET=${MACOS_MINIMUM}`,
  // soxr 0.1.3 declares an old cmake minimum that cmake 4 refuses without this.
  '-DCMAKE_POLICY_VERSION_MINIMUM=3.5',
  '-DBUILD_TESTS=OFF',
  '-DBUILD_EXAMPLES=OFF',
  '-DWITH_OPENMP=OFF',
  '-DWITH_LSR_BINDINGS=OFF',
  '-DWITH_AVFFT=OFF',
]

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${path.basename(command)} ${args[0] ?? ''} failed with exit code ${result.status ?? result.signal}`)
  return result
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${path.basename(command)} ${args.join(' ')} failed: ${(result.stderr || '').trim().slice(-2000)}`)
  return result.stdout
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function buildCacheRoot() {
  return process.env.PUROS_BUILD_CACHE
    ? path.resolve(process.env.PUROS_BUILD_CACHE)
    : path.join(os.homedir(), 'Library', 'Caches', 'puros-build')
}

export function soxrBuildIdentity() {
  const digest = crypto.createHash('sha256')
    .update(JSON.stringify({ SOXR_SOURCE_SHA256, CMAKE_FLAGS, MACOS_MINIMUM, ARCHS }))
    .digest('hex')
    .slice(0, 12)
  return `${SOXR_VERSION}-${digest}`
}

function findCmake() {
  const candidate = ['/opt/homebrew/bin/cmake', '/usr/local/bin/cmake']
    .find((file) => fs.existsSync(file))
  if (candidate) return candidate
  const which = spawnSync('/usr/bin/which', ['cmake'], { encoding: 'utf8' })
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim()
  throw new Error('cmake is required to build libsoxr (brew install cmake)')
}

function downloadSource(cacheRoot) {
  const archive = path.join(cacheRoot, 'src', `soxr-${SOXR_VERSION}-Source.tar.xz`)
  if (fs.existsSync(archive) && sha256File(archive) === SOXR_SOURCE_SHA256) return archive
  fs.mkdirSync(path.dirname(archive), { recursive: true })
  const partial = `${archive}.${process.pid}.partial`
  console.log(`Downloading ${SOXR_SOURCE_URL}`)
  run('curl', ['--fail', '--location', '--silent', '--show-error', '--tlsv1.2', '--output', partial, SOXR_SOURCE_URL])
  const actual = sha256File(partial)
  if (actual !== SOXR_SOURCE_SHA256) {
    fs.rmSync(partial, { force: true })
    throw new Error(`libsoxr source checksum mismatch: expected ${SOXR_SOURCE_SHA256}, got ${actual}`)
  }
  fs.renameSync(partial, archive)
  return archive
}

function buildSlice(archive, workRoot, arch, shared) {
  const sourceRoot = path.join(workRoot, `src-${arch}-${shared ? 'shared' : 'static'}`)
  const buildRoot = `${sourceRoot}-build`
  fs.mkdirSync(sourceRoot, { recursive: true })
  run('tar', ['-xJf', archive, '-C', sourceRoot, '--strip-components=1'])
  const clang = capture('xcrun', ['--sdk', 'macosx', '-f', 'clang']).trim()
  const sdk = capture('xcrun', ['--sdk', 'macosx', '--show-sdk-path']).trim()
  const cmake = findCmake()
  const env = {
    PATH: `/usr/bin:/bin:/usr/sbin:/sbin:${path.dirname(cmake)}`,
    HOME: os.homedir(),
    SDKROOT: sdk,
    TMPDIR: os.tmpdir(),
  }
  run(cmake, [
    '-S', sourceRoot,
    '-B', buildRoot,
    '-Wno-dev',
    ...CMAKE_FLAGS,
    `-DCMAKE_OSX_ARCHITECTURES=${arch}`,
    `-DCMAKE_C_COMPILER=${clang}`,
    `-DCMAKE_C_FLAGS=-ffile-prefix-map=${sourceRoot}=soxr`,
    `-DBUILD_SHARED_LIBS=${shared ? 'ON' : 'OFF'}`,
  ], { env, stdio: ['ignore', 'ignore', 'inherit'] })
  run(cmake, ['--build', buildRoot, '-j', String(Math.max(2, os.availableParallelism?.() ?? os.cpus().length))], { env, stdio: ['ignore', 'ignore', 'inherit'] })

  const libDir = path.join(buildRoot, 'src')
  if (!shared) return { library: path.join(libDir, 'libsoxr.a'), sourceRoot }
  // The versioned file is the real library; libsoxr.0.dylib is a symlink to it.
  const real = fs.readdirSync(libDir).find((name) => /^libsoxr\.\d+\.\d+\.\d+\.dylib$/.test(name))
  if (!real) throw new Error(`libsoxr ${arch} shared build produced no dylib`)
  return { library: path.join(libDir, real), sourceRoot }
}

/** Build (once per configuration) and return the directory holding headers, dylib, static archive and licence. */
export function ensureSoxr() {
  if (process.platform !== 'darwin') throw new Error('The libsoxr build is macOS-only')
  const cacheRoot = buildCacheRoot()
  const outputRoot = path.join(cacheRoot, 'soxr', soxrBuildIdentity())
  const stamp = path.join(outputRoot, 'BUILD-INFO.json')
  const dylib = path.join(outputRoot, 'lib', SOXR_DYLIB_NAME)
  const archiveLib = path.join(outputRoot, 'lib-static', 'libsoxr.a')
  if (fs.existsSync(stamp) && fs.existsSync(dylib) && fs.existsSync(archiveLib)) {
    const info = JSON.parse(fs.readFileSync(stamp, 'utf8'))
    if (info.dylibSha256 === sha256File(dylib)) return outputRoot
  }

  const archive = downloadSource(cacheRoot)
  const workRoot = fs.mkdtempSync(path.join(cacheRoot, 'soxr-work-'))
  try {
    const staging = path.join(workRoot, 'out')
    for (const dir of ['include', 'lib', 'lib-static']) fs.mkdirSync(path.join(staging, dir), { recursive: true })

    const sharedSlices = ARCHS.map((arch) => buildSlice(archive, workRoot, arch, true))
    const staticSlices = ARCHS.map((arch) => buildSlice(archive, workRoot, arch, false))

    const stagedDylib = path.join(staging, 'lib', SOXR_DYLIB_NAME)
    run('lipo', ['-create', ...sharedSlices.map((slice) => slice.library), '-output', stagedDylib])
    run('install_name_tool', ['-id', `@rpath/${SOXR_DYLIB_NAME}`, stagedDylib])
    run('codesign', ['--force', '--sign', '-', stagedDylib])
    run('lipo', ['-create', ...staticSlices.map((slice) => slice.library), '-output', path.join(staging, 'lib-static', 'libsoxr.a')])

    const sourceRoot = sharedSlices[0].sourceRoot
    fs.copyFileSync(path.join(sourceRoot, 'src', 'soxr.h'), path.join(staging, 'include', 'soxr.h'))
    fs.copyFileSync(path.join(sourceRoot, 'COPYING.LGPL'), path.join(staging, 'SOXR-COPYING.LGPL'))

    const exported = capture('nm', ['-gU', '-arch', 'arm64', stagedDylib])
    if (!/\b_soxr_create\b/.test(exported)) throw new Error('libsoxr dylib does not export soxr_create')
    const archs = capture('lipo', ['-archs', stagedDylib]).trim().split(/\s+/).sort()

    fs.writeFileSync(path.join(staging, 'BUILD-INFO.json'), `${JSON.stringify({
      soxrVersion: SOXR_VERSION,
      sourceUrl: SOXR_SOURCE_URL,
      sourceSha256: SOXR_SOURCE_SHA256,
      license: 'LGPL-2.1-or-later',
      cmakeFlags: CMAKE_FLAGS,
      macosMinimum: MACOS_MINIMUM,
      architectures: archs,
      dylibSha256: sha256File(stagedDylib),
    }, null, 2)}\n`)
    fs.rmSync(outputRoot, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(outputRoot), { recursive: true })
    fs.renameSync(staging, outputRoot)
    return outputRoot
  } finally {
    fs.rmSync(workRoot, { recursive: true, force: true })
  }
}

/** Copy the verified build into `destination` (headers, dylib, static archive, licence, build record). */
export function installSoxr(destination) {
  const source = ensureSoxr()
  fs.rmSync(destination, { recursive: true, force: true })
  fs.cpSync(source, destination, { recursive: true, verbatimSymlinks: true })
  return destination
}
