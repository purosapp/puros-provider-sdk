#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { loadProvider, runBuildSteps } from '../tooling/manifest.mjs'
import { packProvider } from '../tooling/package.mjs'
import { generateSigningKey } from '../tooling/keygen.mjs'
import { ensureSelfContainedFfmpeg, installSelfContainedFfmpeg } from '../tooling/ffmpeg.mjs'

const USAGE = `Usage: puros-provider <command> [options]

Commands (run from the provider root, the directory with provider.manifest.json):
  validate                     Check provider.manifest.json and the src/index.ts entry.
  build                        Run the manifest's build steps (helpers, bundled binaries).
  pack [--skip-build] [--out=<dir>] [--sign-key=<pem>]
                               Build, compile and write puros-provider-<id>-<version>.zip
                               (default --out=release). PUROS_PROVIDER_SIGNING_KEY also sets the key.
  keygen --out=<pem>           Create an Ed25519 publisher key outside the repository.
  ffmpeg [--install=<dir>]     Build (or reuse) the pinned self-contained LGPL ffmpeg;
                               --install copies it with its license and build record.

Options:
  --root=<dir>                 Provider root instead of the current directory.
  --version                    Print the SDK version.`

function parse(argv) {
  const [command, ...rest] = argv
  const options = {}
  for (const arg of rest) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg)
    if (!match) throw new Error(`Unexpected argument: ${arg}\n\n${USAGE}`)
    options[match[1]] = match[2] ?? true
  }
  return { command, options }
}

function allow(options, names) {
  const unknown = Object.keys(options).filter((name) => !['root', ...names].includes(name))
  if (unknown.length > 0) throw new Error(`Unknown option --${unknown[0]}\n\n${USAGE}`)
}

function providerAt(options) {
  const root = path.resolve(typeof options.root === 'string' ? options.root : '.')
  // The packer requires a fixed working directory so compiled bytes do not depend on the caller.
  process.chdir(root)
  return loadProvider(root)
}

async function main() {
  const { command, options } = parse(process.argv.slice(2))
  if (!command || command === 'help' || command === '--help' || options.help) {
    console.log(USAGE)
    return
  }
  if (command === '--version') {
    const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    console.log(manifest.version)
    return
  }
  if (command === 'validate') {
    allow(options, [])
    const { manifest } = providerAt(options)
    console.log(`${manifest.id} ${manifest.version}: manifest valid (${manifest.capabilities.length} capabilities)`)
  } else if (command === 'build') {
    allow(options, [])
    runBuildSteps([providerAt(options)])
  } else if (command === 'pack') {
    allow(options, ['skip-build', 'out', 'sign-key'])
    const invocationRoot = process.cwd()
    const provider = providerAt(options)
    const outputRoot = typeof options.out === 'string' ? path.resolve(invocationRoot, options.out) : path.join(provider.root, 'release')
    const signingKey = typeof options['sign-key'] === 'string' ? path.resolve(invocationRoot, options['sign-key']) : process.env.PUROS_PROVIDER_SIGNING_KEY || null
    const result = await packProvider(provider, { skipBuild: options['skip-build'] === true, outputRoot, signingKeyPath: signingKey })
    const platform = result.descriptor.platform ? `darwin/${result.descriptor.platform.arch.join('+')}` : 'any platform'
    const shown = path.relative(invocationRoot, result.zipPath)
    console.log(`${shown.startsWith('..') ? result.zipPath : shown}  ${result.size} bytes  ${platform}  ${result.signed ? 'signed' : 'unsigned'}  sha256 ${result.sha256}`)
  } else if (command === 'keygen') {
    allow(options, ['out'])
    if (typeof options.out !== 'string') throw new Error('Usage: puros-provider keygen --out=<path outside the repository>')
    const key = generateSigningKey(options.out, { forbiddenRoots: [process.cwd()] })
    console.log(`Private key written to ${key.path} (mode 0600). Keep it offline or in Keychain; never commit it.`)
    console.log(`Public key (base64): ${key.publicKey}`)
    console.log(`Publisher key ID:    ${key.keyId}`)
  } else if (command === 'ffmpeg') {
    allow(options, ['install'])
    if (typeof options.install === 'string') console.log(installSelfContainedFfmpeg(path.resolve(options.install)))
    else console.log(path.join(ensureSelfContainedFfmpeg(), 'ffmpeg'))
  } else {
    throw new Error(`Unknown command: ${command}\n\n${USAGE}`)
  }
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
