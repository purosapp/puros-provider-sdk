# Puros Provider SDK

The public contract and toolchain for **Puros provider plugins**. Puros is a closed-source macOS music player built for audio quality; providers connect it to streaming services and are developed in their own repositories against this package.

- **Provider API v1**: the TypeScript types, constants and validators a provider implements (`import … from 'puros-provider-sdk'`).
- **`puros-provider` CLI**: validates the manifest, runs helper builds, compiles the provider into an installable, reproducible ZIP, signs it, and builds the pinned LGPL ffmpeg that helpers may bundle.
- **[`example/`](example/)**: a complete offline provider to start from.

SDK `1.x` implements Provider API v1 (`apiVersion: 1`).

## Division of work

Puros owns the local library, SQLite, catalog identity and deduplication, queue, source priority, format negotiation, decoding, DSP, CoreAudio output, cache quotas and every view. A provider owns its service's authentication and API, catalog mapping, library enumeration, quality choices, file download/decryption and optional metadata. Providers ship no UI: settings are declared in the manifest and rendered by Puros.

## Quick start

```sh
mkdir puros-provider-myservice && cd puros-provider-myservice
npm init -y
npm install --save-dev puros-provider-sdk typescript vitest @types/node
```

Copy [`example/`](example/) (`provider.manifest.json`, `src/`, `assets/`), set `"type": "module"` in `package.json`, change the manifest `id`, `displayName` and resource paths, and add:

```json
{
  "scripts": {
    "validate": "puros-provider validate",
    "typecheck": "tsc",
    "test": "vitest run",
    "build": "puros-provider build",
    "package": "puros-provider pack"
  }
}
```

A `tsconfig.json` that matches the SDK's own settings:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"],
    "strict": true
  },
  "include": ["src"]
}
```

The entry point `src/index.ts` default-exports a `ProviderPluginV1`:

```ts
import manifestJson from '../provider.manifest.json'
import { API_VERSION, type ProviderManifestV1, type ProviderPluginV1 } from 'puros-provider-sdk'

const plugin: ProviderPluginV1 = {
  apiVersion: API_VERSION,
  manifest: manifestJson as ProviderManifestV1,
  async activate(host) {
    return {
      capabilities: { /* exactly the capabilities listed in the manifest */ },
      async getStatus() { return { state: 'ready', authenticated: false, updatedAt: Date.now() } },
      async deactivate() { /* cancel in-flight work, release resources */ },
    }
  },
}

export default plugin
```

Then `npm run package` writes `release/puros-provider-<id>-<version>.zip`. Install it in Puros from **Settings → Accounts → Install provider…**.

## CLI

Run from the provider root (the directory with `provider.manifest.json`), or pass `--root=<dir>`.

| Command | What it does |
| --- | --- |
| `puros-provider validate` | Checks the manifest's build-time rules and that `src/index.ts` exists. |
| `puros-provider build` | Runs the manifest's `build.steps` for this platform. Steps get `PUROS_PROVIDER_ROOT` and `PUROS_PROVIDER_CLI`, so a helper build can call `node "$PUROS_PROVIDER_CLI" ffmpeg --install=helper/dist`. |
| `puros-provider pack [--skip-build] [--out=<dir>] [--sign-key=<pem>]` | Builds, compiles and packages (default output `release/`). `PUROS_PROVIDER_SIGNING_KEY` also sets the key. |
| `puros-provider keygen --out=<pem>` | Creates an Ed25519 publisher key (mode `0600`); refuses a path inside the current directory. |
| `puros-provider ffmpeg [--install=<dir>]` | Builds (or reuses from `~/Library/Caches/puros-build`, or `PUROS_BUILD_CACHE`) the pinned, self-contained LGPL ffmpeg with libsoxr; `--install` copies it with its license and build record. Needs Xcode command line tools and cmake. |

The build tools are also importable for scripts: `import { packProvider, loadProvider } from 'puros-provider-sdk/tooling'`.

## Packages

`pack` compiles `src/index.ts` into one self-contained ESM file (`dist/index.mjs`; only `node:` built-ins stay external, so npm dependencies and this SDK's API code are bundled) and writes `puros-provider-<id>-<version>.zip` with a `.sha256` sidecar. The archive holds `puros-provider.json` (format descriptor with every file's size, SHA-256 and mode, plus the platform/CPU derived from declared Mach-O `build.binaries`), `provider.manifest.json`, the compiled entry, and every `build.extraResources` file relocated from `providers/<id>/…` to the package root, the same layout `host.paths.getResourceRoot()` exposes. Build steps are never stored or run from a package.

Packing is deterministic: fixed entry order, DOS-epoch timestamps, normalized `0644`/`0755` modes, no absolute build paths; the same sources, helper outputs and lockfile toolchain produce identical bytes. Packing fails on symlinks, resources outside the provider directory, reserved or case-colliding paths, missing icon/helper/binary files, non-executable helpers, dotenv/private-key files or markers, and any file containing the build machine's value of a declared `runtimeEnvironment` variable. It also fails when a declared binary links dylibs outside macOS: packaged binaries must be self-contained.

Signing is optional but recommended. `pack --sign-key=<path>` adds `puros-provider.sig`, a detached Ed25519 signature over the exact descriptor bytes. Because the descriptor hashes every file, the signature covers the whole package, and Ed25519 keeps signed archives reproducible. Keep one key per publisher: Puros pins the key that installed a provider ID and warns loudly if a later update is signed by a different key or not signed at all.

Puros imports packages through a strict reader that accepts only this format. It re-checks every hash, the manifest, platform and native binaries, verifies any signature, and inspects helper code signatures with `codesign`. Native binaries need at least an ad-hoc signature (`codesign --sign - <file>`); without Developer ID signing, users see an extra warning. Unsigned packages install too, behind an "unsigned, publisher unverified" warning. A consent dialog shows the manifest's capabilities, origins, helpers, secrets and environment names, plus every warning. **Update from file…** swaps the code without an app restart, keeps provider data and the enabled state, and restores the previous version if activation fails. Installed code runs from `<userData>/provider-packages` and is re-verified at every start. Disabling a provider or removing its code keeps its data.

## Continuous integration

The first-party providers (for example [puros-provider-soundcloud](https://github.com/jacobbvfx/puros-provider-soundcloud/blob/main/.github/workflows/build.yml)) use one GitHub Actions workflow you can copy: on a `macos-15` runner it runs `npm ci`, `validate`, `typecheck`, `test`, caches `~/Library/Caches/puros-build`, runs `npm run package` and uploads `release/` as an artifact. A tag `v<version>` matching the manifest publishes a GitHub release, signed when the repository secret `PUROS_PROVIDER_SIGNING_KEY` holds the publisher key (PEM).

## Manifest reference

The exact shapes and bounds live in [`src/manifest.ts`](src/manifest.ts), the [JSON Schema](src/provider-manifest.schema.json) (`puros-provider-sdk/provider-manifest.schema.json`), and the host's runtime validator. The runtime validator is authoritative when these disagree.

| Field | Meaning |
| --- | --- |
| `schemaVersion`, `apiVersion` | Both are `1` for this contract; incompatible versions fail activation. |
| `id`, `version`, `displayName` | Stable provider identity (`^[a-z][a-z0-9-]{1,31}$`; `local` and `m3u` are reserved), provider release string, Puros-rendered label. |
| `icon`, `brandColor` | Provider-relative icon and `#RRGGBB` color; no provider React. |
| `defaultPriority` | Nonnegative default insertion order; Puros persists the user's final order. |
| `capabilities` | Unique v1 capability IDs; runtime keys must match exactly. |
| `librarySyncMode` | Optional `host-mirror`; only use with `library.sync` and complete, stable snapshots. |
| `playbackTimeoutMs` | Optional bounded playback deadline, 120,000–1,800,000 ms. |
| `requiredHostFeatures` | Optional post-v1 host features the provider relies on (`audio-format.vorbis`, `audio-format.opus`, `playback.source-format`, `playback.format-support`, `settings.form`, `auth.browser-session`). Hosts reject unknown features; hosts older than the field reject it as an unknown property, so the package never activates there. |
| `settings` | Puros-rendered `text`, `select`, `toggle`, `action`, `status`, or `form` controls. |
| `permissions` | Declared runtime env names, origins, secret keys, auth collections, and helpers. |
| `build` | Provider-local build steps plus packaged `extraResources` and `binaries`. Resource and binary destinations use the `providers/<id>/…` prefix. |

Settings use `host.settings` under `provider.<id>.<key>` or `host.secrets` for a declared secret. An action must name a declared capability and implemented method; its `args` reach the method as declared (for `auth.login`, a `ProviderAuthLoginRequestV1`). Status controls read `ProviderStatusV1.values`. A `form` control (host feature `settings.form`, which the manifest must list) renders ordered `instructions` and up to eight `fields` (`multiline`, `sensitive`, `required`, `maxLength` ≤ 65,536) and calls `submit.capability`/`submit.method` once with `{ form: <setting id>, values: { <field id>: string } }`. Puros never stores form values and clears them after every submission; `sensitive` fields are masked. Use it for credentials a user pastes, validate them in the provider, persist only through `host.secrets`, and never echo them in results, errors, events or logs. The renderer cannot read secrets. Private plugin state belongs in `host.storage`, not global settings. Ordinary logout and provider absence do **not** delete imported rows, source links, cache entries or settings; only the explicit per-provider remove-data action does that.

`permissions.runtimeEnvironment` is an exceptional compatibility path for exact uppercase names prefixed by the provider ID (hyphens become underscores). Values are not bundled; only named variables are forwarded to that provider process. Prefer declared `host.secrets` for credentials.

`networkOrigins` describe intended endpoints but are **not** network egress enforcement. `externalOrigins` constrain `host.openExternal`; `authCollections` define an origin-restricted host auth window (`host.openAuthWindow`) and the precise cookie/localStorage/URL values it may return. With host feature `auth.browser-session` a collection may also return a `cookieJar` (every cookie of the listed `domains` as a Netscape cookie file, collected once the window shows `origin` and all `requiredCookies` exist), and the request may use an in-memory partition (`puros-provider-<id>[-suffix]`, without `persist:`), which the host wipes before the window opens and after it closes, plus `userAgent: 'browser'` (Google Chrome of the embedded Chromium's version) or `userAgent: 'firefox'` (for sign-in pages that reject embedded Chromium). Providers receive no `BrowserWindow` or `webContents`. Helper declarations name provider-relative executables and either allowed argv atoms or an exact cache-path template. The host launches only declared helpers, with a restricted environment and the provider data directory as `cwd`. Build steps run without a shell and must remain within the provider directory. List packaged helper binaries in `build.binaries`.

## Capability and lifecycle contract

All calls are asynchronous and must return structured-clone-safe plain values. The process wire has an 8 MiB message cap, 32-level value-depth bound, and 30 events/second budget; progress is coalesced. `Uint8Array` is available only for private helper transport, not public capability DTOs. Throw ordinary errors for failures (or `ProviderApiError` for a typed code); the host normalizes them into typed `ProviderResultV1` errors. Do not pass functions, class instances, native handles or secrets as capability results/events.

| Capability | Required methods |
| --- | --- |
| `auth` | `getStatus`, `login`, `logout` |
| `catalog.search` | `search` |
| `catalog.entities` | `getArtist`, `getArtistBundle`, `getAlbum`, `getAlbumBundle`, `getTrack` |
| `catalog.home` | `getShelves`, `getCollection` |
| `library.sync` | `enumerate` |
| `playlists` | `list`, `get`, `getTracks` |
| `playback.resolve` | `resolve` |
| `playback.prefetch` | `prefetch` |
| `playback.progressive` | `markPlaybackStarted`, `cancel` |
| `quality.tiers` | `list`, `getSelected`, `select` |
| `metadata.artwork` | `getArtwork` |
| `metadata.bio` | `getBio` |
| `metadata.credits` | `getCredits` |

See [`src/capabilities.ts`](src/capabilities.ts) for DTO fields and optional methods. `ProviderRuntimeV1.cancelSession` is an optional generic session cancellation hook. Use `host.events.emit` for status/auth, library, warning, and playback-session/progress updates. `getStatus()` returns `ready`, `degraded`, or another defined lifecycle state with a timestamp. `deactivate()` must cancel in-flight work and release provider-owned resources. Calls have deadlines (normally 30 seconds, longer for auth/sync/playback); a timeout, crash, malformed response or event flood can terminate and restart the provider process under a bounded policy.

For `librarySyncMode: 'host-mirror'`, enumerate bounded pages with a stable advancing cursor and set `complete: true` only after the entire snapshot succeeds. Puros may reconcile rows against the completed snapshot. A partial response falsely marked complete can remove stale provider imports, so fail closed on pagination/auth errors.

## File playback and cache

`playback.resolve` returns `PlaybackArtifactV1 { path, lifecycle, format, sourceFormat?, sessionId? }`. `format` describes the prepared file and drives output negotiation; `sourceFormat` (host feature `playback.source-format`) describes what the service delivered when the file is a conversion, for example a lossy Vorbis source decoded into FLAC, and drives quality labels and lossless checks. Pass the same `sourceFormat` to `host.cache.put`; cache hits return it. `host.cache.canPlayFormat(format)` (host feature `playback.format-support`) tells whether Puros plays a file of that format directly: FLAC, ALAC, AIFF, WAV, MP3 and AAC always; `VORBIS` (Ogg) and `OPUS` (Ogg, host feature `audio-format.opus`) only when the Mac's AudioToolbox decodes them; DSD artifacts never. Opus in WebM or MP4 is never opened directly: remux it to Ogg with a stream copy. Lossy formats (`MP3`, `AAC`, `VORBIS`, `OPUS`) are rejected when labelled lossless, Hi-Res, MQA or DSD, and `OPUS` must report its 48 kHz decode rate. Report `bitDepth: 0` for lossy sources.

`path` must identify an existing file inside the provider's `host.paths.getCacheRoot()`; the host canonicalizes paths and rejects escapes and symlinks outside it. `complete` means a finished, stable file. `growing` requires `playback.progressive` and a valid session ID; report progress and cancellation through session events. A `completed` session event may carry `format` (and `sourceFormat`) for the finished file when it is more precise than the growing artifact's.

Use `host.cache` to look up and register completed files and let Puros own cache metadata and quota. `host.catalog` provides narrow provider-scoped reads and format writes. `getResourceRoot()` is for read-only packaged assets, not a playback artifact root; copy an asset into the cache root before returning it, as the example does.

## Source ownership

Puros identifies every artist, album, track and playlist by provider ID, entity type and source ID. IDs may overlap across plugins; names, UPCs and ISRCs never merge their catalogs. Search and profile requests target one provider, and all returned children and credits must belong to that provider. Keep source IDs stable across search, library sync, entity details and playback. Playback and prefetch request the exact recorded source ID; if it is unavailable, return the appropriate error rather than substituting another recording.

## Isolation and review

Each provider runs in its own Electron `utilityProcess` with a provider-data `cwd`, restricted environment, call deadlines, payload/event bounds and a crash/restart policy. **This is not an OS sandbox.** Provider code has Node.js filesystem/process APIs and unrestricted network access; manifest origins are declarations, not network filtering. Users should install only providers they trust, and authors should document bundled helper binaries, their licenses and the remote service's terms.

## License

MIT, see [LICENSE](LICENSE). `puros-provider ffmpeg` downloads and builds ffmpeg (LGPL-2.1-or-later) and libsoxr (LGPL-2.1-or-later) from their pinned upstream sources; packages that bundle the result ship their license texts and build record.
