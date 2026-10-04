import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { ensureSoxr, soxrBuildIdentity } from './soxr.mjs'

// Pinned source. The SHA-256 was cross-checked on 2026-09-28 against two
// independent records: the ffmpeg.org download and Homebrew's formula API.
export const FFMPEG_VERSION = '9.0.2'
const FFMPEG_SOURCE_URL = `https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz`
const FFMPEG_SOURCE_SHA256 = '8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e'
const MACOS_MINIMUM = '12.0'
const DEFAULT_ARCHS = ['arm64', 'x86_64']

// A full *native* LGPL-2.1+ build: every built-in demuxer/decoder/filter stays,
// but no GPL/nonfree code, device, or hardware accelerator. The one external
// library is libsoxr (LGPL-2.1+, built by build-soxr.mjs and linked statically)
// so DSD → PCM conversion uses the same SoX resampler as the audio engine.
// --disable-autodetect keeps Homebrew/pkg-config libraries from leaking in; only
// macOS system libraries/frameworks (SecureTransport TLS, zlib) are linked.
const CONFIGURE_FLAGS = [
  '--disable-autodetect',
  '--enable-securetransport',
  '--enable-zlib',
  '--enable-libsoxr',
  '--disable-shared',
  '--enable-static',
  '--disable-programs',
  '--enable-ffmpeg',
  '--disable-doc',
  '--disable-debug',
  '--disable-devices',
  '--disable-hwaccels',
  '--extra-version=puros',
]

const SYSTEM_LIBRARY_PREFIXES = ['/usr/lib/', '/System/Library/']
const REQUIRED_COMPONENTS = {
  demuxers: ['dsf', 'iff', 'mp3', 'aac', 'ogg', 'flac', 'hls', 'mov', 'wav', 'matroska', 'mpegts'],
  // ogg/ipod carry stream-copied Opus/AAC for provider playback; webm and the (experimental,
  // native) opus encoder only build verification fixtures.
  muxers: ['wav', 's16le', 's32le', 'flac', 'null', 'mov', 'mp4', 'ipod', 'ogg', 'webm'],
  decoders: ['dsd_lsbf', 'dsd_msbf', 'dsd_lsbf_planar', 'dsd_msbf_planar', 'mp3float', 'aac', 'vorbis', 'opus', 'flac', 'mjpeg', 'png'],
  encoders: ['pcm_f32le', 'pcm_s16le', 'pcm_s32le', 'wrapped_avframe', 'png', 'flac', 'aac', 'opus'],
  protocols: ['file', 'pipe', 'http', 'https', 'tcp', 'tls'],
  // asupercut + volume shape DSD → PCM (ultrasonic noise filter, level compensation).
  filters: ['aresample', 'aformat', 'anull', 'asupercut', 'volume'],
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${path.basename(command)} ${args[0] ?? ''} failed with exit code ${result.status ?? result.signal}`)
  return result
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${path.basename(command)} ${args.join(' ')} failed: ${(result.stderr || '').trim().slice(-2000)}`)
  return result.stdout
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

export function ffmpegBuildCacheRoot() {
  return process.env.PUROS_BUILD_CACHE
    ? path.resolve(process.env.PUROS_BUILD_CACHE)
    : path.join(os.homedir(), 'Library', 'Caches', 'puros-build')
}

function requestedArchitectures() {
  const archs = (process.env.PUROS_FFMPEG_ARCHS ?? DEFAULT_ARCHS.join(' ')).split(/[\s,]+/).filter(Boolean)
  const unknown = archs.filter((arch) => !DEFAULT_ARCHS.includes(arch))
  if (archs.length === 0 || unknown.length > 0) throw new Error(`PUROS_FFMPEG_ARCHS must list arm64 and/or x86_64, got ${archs.join(' ')}`)
  return [...new Set(archs)].sort()
}

function buildIdentity(archs) {
  const digest = crypto.createHash('sha256')
    .update(JSON.stringify({ FFMPEG_SOURCE_SHA256, CONFIGURE_FLAGS, MACOS_MINIMUM, archs, soxr: soxrBuildIdentity() }))
    .digest('hex')
    .slice(0, 12)
  return `${FFMPEG_VERSION}-${digest}`
}

/** Paths of every dylib an executable loads, for every architecture slice. */
export function listLinkedLibraries(executable) {
  return capture('otool', ['-arch', 'all', '-L', executable])
    .split('\n')
    .map((line) => line.trim().match(/^(\S+\.dylib|\S+\.framework\/\S+)\s+\(/)?.[1])
    .filter(Boolean)
}

export function findNonSystemLibraries(executable) {
  return [...new Set(listLinkedLibraries(executable))]
    .filter((library) => !SYSTEM_LIBRARY_PREFIXES.some((prefix) => library.startsWith(prefix)))
}

function downloadSource(cacheRoot) {
  const sourceArchive = path.join(cacheRoot, 'src', `ffmpeg-${FFMPEG_VERSION}.tar.xz`)
  if (fs.existsSync(sourceArchive) && sha256File(sourceArchive) === FFMPEG_SOURCE_SHA256) return sourceArchive
  fs.mkdirSync(path.dirname(sourceArchive), { recursive: true })
  const partial = `${sourceArchive}.${process.pid}.partial`
  console.log(`Downloading ${FFMPEG_SOURCE_URL}`)
  run('curl', ['--fail', '--location', '--silent', '--show-error', '--proto', '=https', '--tlsv1.2', '--output', partial, FFMPEG_SOURCE_URL])
  const actual = sha256File(partial)
  if (actual !== FFMPEG_SOURCE_SHA256) {
    fs.rmSync(partial, { force: true })
    throw new Error(`FFmpeg source checksum mismatch: expected ${FFMPEG_SOURCE_SHA256}, got ${actual}`)
  }
  fs.renameSync(partial, sourceArchive)
  return sourceArchive
}

function buildSlice(sourceArchive, workRoot, sliceRoot, arch, soxrRoot) {
  // Finished slices are cached so a failed later step never forces a rebuild.
  const cached = path.join(sliceRoot, arch)
  if (fs.existsSync(path.join(cached, 'ffmpeg')) && fs.existsSync(path.join(cached, 'COPYING.LGPLv2.1'))) {
    return { binary: path.join(cached, 'ffmpeg'), license: path.join(cached, 'COPYING.LGPLv2.1') }
  }
  const sourceRoot = path.join(workRoot, arch)
  fs.rmSync(sourceRoot, { recursive: true, force: true })
  fs.mkdirSync(sourceRoot, { recursive: true })
  run('tar', ['-xJf', sourceArchive, '-C', sourceRoot, '--strip-components=1'])
  // Always Xcode's clang and SDK: a Homebrew LLVM earlier on PATH cannot target the app's SDK.
  const clang = capture('xcrun', ['--sdk', 'macosx', '-f', 'clang']).trim()
  const sdk = capture('xcrun', ['--sdk', 'macosx', '--show-sdk-path']).trim()
  const targetFlags = `-arch ${arch} -mmacosx-version-min=${MACOS_MINIMUM}`
  const hostArch = os.arch() === 'arm64' ? 'arm64' : 'x86_64'
  const env = {
    PATH: `/usr/bin:/bin:/usr/sbin:/sbin:${path.dirname(capture('xcrun', ['-f', 'make']).trim())}`,
    HOME: os.homedir(),
    SDKROOT: sdk,
    // Nothing from the developer's shell may redirect headers, libraries, or pkg-config.
    PKG_CONFIG_LIBDIR: '/nonexistent',
    TMPDIR: os.tmpdir(),
  }
  const flags = [
    ...CONFIGURE_FLAGS,
    `--cc=${clang}`,
    `--arch=${arch === 'arm64' ? 'aarch64' : 'x86_64'}`,
    '--target-os=darwin',
    // Keep build-machine paths (and user names) out of __FILE__ strings in the binary.
    // lib-static holds only libsoxr.a, so the linker cannot pick a dylib.
    `--extra-cflags=${targetFlags} -ffile-prefix-map=${sourceRoot}=ffmpeg -I${path.join(soxrRoot, 'include')}`,
    `--extra-ldflags=${targetFlags} -L${path.join(soxrRoot, 'lib-static')}`,
  ]
  if (arch !== hostArch) flags.push('--enable-cross-compile')
  if (arch === 'x86_64') {
    const nasm = ['/opt/homebrew/bin/nasm', '/usr/local/bin/nasm'].find((candidate) => fs.existsSync(candidate))
    // nasm is only a build tool; without it x86 SIMD is disabled, not the component.
    flags.push(nasm ? `--x86asmexe=${nasm}` : '--disable-x86asm')
  }
  console.log(`Configuring FFmpeg ${FFMPEG_VERSION} for ${arch}`)
  run('./configure', flags, { cwd: sourceRoot, env })
  run('make', [`-j${Math.max(2, os.availableParallelism?.() ?? os.cpus().length)}`, 'ffmpeg'], { cwd: sourceRoot, env })
  run('strip', ['-x', path.join(sourceRoot, 'ffmpeg')])
  const staging = `${cached}.${process.pid}.partial`
  fs.rmSync(staging, { recursive: true, force: true })
  fs.mkdirSync(staging, { recursive: true })
  fs.copyFileSync(path.join(sourceRoot, 'ffmpeg'), path.join(staging, 'ffmpeg'))
  fs.copyFileSync(path.join(sourceRoot, 'COPYING.LGPLv2.1'), path.join(staging, 'COPYING.LGPLv2.1'))
  fs.rmSync(cached, { recursive: true, force: true })
  fs.renameSync(staging, cached)
  fs.rmSync(sourceRoot, { recursive: true, force: true })
  return { binary: path.join(cached, 'ffmpeg'), license: path.join(cached, 'COPYING.LGPLv2.1') }
}

function verifyComponents(executable, runner) {
  const missing = []
  for (const [kind, names] of Object.entries(REQUIRED_COMPONENTS)) {
    const listing = capture(runner[0], [...runner.slice(1), executable, '-hide_banner', `-${kind}`])
    const available = new Set(listing.split('\n').flatMap((line) => {
      const fields = line.trim().split(/\s+/)
      // Protocol listings are bare names; the others start with a flags column,
      // and (de)muxers may list comma-separated aliases such as "mov,mp4,m4a".
      return (kind === 'protocols' ? fields[0] : fields[1])?.split(',') ?? []
    }).filter(Boolean))
    for (const name of names) if (!available.has(name)) missing.push(`${kind.slice(0, -1)} ${name}`)
  }
  if (missing.length > 0) throw new Error(`Self-contained ffmpeg lacks required components: ${missing.join(', ')}`)
}

/** Static checks that the binary is self-contained, LGPL, and has every component Puros invokes. */
export function verifySelfContainedFfmpeg(executable) {
  const nonSystem = findNonSystemLibraries(executable)
  if (nonSystem.length > 0) throw new Error(`ffmpeg links libraries outside macOS: ${nonSystem.join(', ')}`)
  const version = capture(executable, ['-hide_banner', '-L'])
  const buildConfiguration = capture(executable, ['-version'])
  if (!/GNU Lesser General Public\s+License[\s\S]*version 2\.1 of the License/.test(version)
    || /--enable-(gpl|nonfree|version3)/.test(buildConfiguration)) {
    throw new Error('ffmpeg is not an LGPL-2.1+ build')
  }
  if (!buildConfiguration.includes('--enable-libsoxr')) throw new Error('ffmpeg was built without libsoxr')
  const archs = capture('lipo', ['-archs', executable]).trim().split(/\s+/).sort()
  for (const arch of archs) {
    // `arch -<cpu>` runs that exact slice (x86_64 via Rosetta when available).
    const runner = ['/usr/bin/arch', `-${arch}`]
    if (spawnSync(runner[0], [runner[1], '/usr/bin/true']).status !== 0) {
      console.warn(`Skipping ffmpeg ${arch} component check: this Mac cannot execute ${arch}`)
      continue
    }
    verifyComponents(executable, runner)
  }
  return archs
}

/**
 * Returns the directory holding a verified, self-contained `ffmpeg` plus its
 * LGPL notice and build record, building it once per configuration.
 */
export function ensureSelfContainedFfmpeg() {
  if (process.platform !== 'darwin') throw new Error('The self-contained ffmpeg build is macOS-only')
  const archs = requestedArchitectures()
  const cacheRoot = ffmpegBuildCacheRoot()
  const outputRoot = path.join(cacheRoot, 'ffmpeg', buildIdentity(archs))
  const executable = path.join(outputRoot, 'ffmpeg')
  const stamp = path.join(outputRoot, 'BUILD-INFO.json')
  if (fs.existsSync(stamp) && fs.existsSync(executable)) {
    const info = JSON.parse(fs.readFileSync(stamp, 'utf8'))
    if (info.executableSha256 === sha256File(executable)) return outputRoot
  }

  const sourceArchive = downloadSource(cacheRoot)
  const soxrRoot = ensureSoxr()
  const workRoot = fs.mkdtempSync(path.join(cacheRoot, 'ffmpeg-work-'))
  try {
    const sliceRoot = path.join(cacheRoot, 'ffmpeg-slices', buildIdentity(archs))
    fs.mkdirSync(sliceRoot, { recursive: true })
    const slices = archs.map((arch) => buildSlice(sourceArchive, workRoot, sliceRoot, arch, soxrRoot))
    const staging = path.join(workRoot, 'out')
    fs.mkdirSync(staging)
    const stagedExecutable = path.join(staging, 'ffmpeg')
    if (slices.length === 1) fs.copyFileSync(slices[0].binary, stagedExecutable)
    else run('lipo', ['-create', ...slices.map((slice) => slice.binary), '-output', stagedExecutable])
    fs.chmodSync(stagedExecutable, 0o755)
    // Apple Silicon requires a valid (ad-hoc) signature on every slice; lipo keeps each slice's.
    run('codesign', ['--force', '--sign', '-', stagedExecutable])
    const verifiedArchs = verifySelfContainedFfmpeg(stagedExecutable)
    fs.copyFileSync(slices[0].license, path.join(staging, 'FFMPEG-COPYING.LGPLv2.1'))
    fs.copyFileSync(path.join(soxrRoot, 'SOXR-COPYING.LGPL'), path.join(staging, 'SOXR-COPYING.LGPL'))
    fs.writeFileSync(stamp.replace(outputRoot, staging), `${JSON.stringify({
      ffmpegVersion: FFMPEG_VERSION,
      sourceUrl: FFMPEG_SOURCE_URL,
      sourceSha256: FFMPEG_SOURCE_SHA256,
      license: 'LGPL-2.1-or-later',
      configureFlags: CONFIGURE_FLAGS,
      soxr: soxrBuildIdentity(),
      macosMinimum: MACOS_MINIMUM,
      architectures: verifiedArchs,
      executableSha256: sha256File(stagedExecutable),
    }, null, 2)}\n`)
    fs.rmSync(outputRoot, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(outputRoot), { recursive: true })
    fs.renameSync(staging, outputRoot)
    return outputRoot
  } finally {
    fs.rmSync(workRoot, { recursive: true, force: true })
  }
}

/** Copies the verified ffmpeg, its LGPL notice, and build record into `destination`. */
export function installSelfContainedFfmpeg(destination) {
  const source = ensureSelfContainedFfmpeg()
  fs.mkdirSync(destination, { recursive: true })
  for (const name of ['ffmpeg', 'FFMPEG-COPYING.LGPLv2.1', 'SOXR-COPYING.LGPL', 'BUILD-INFO.json']) {
    const target = path.join(destination, name === 'BUILD-INFO.json' ? 'FFMPEG-BUILD-INFO.json' : name)
    fs.copyFileSync(path.join(source, name), target)
  }
  fs.chmodSync(path.join(destination, 'ffmpeg'), 0o755)
  return path.join(destination, 'ffmpeg')
}
