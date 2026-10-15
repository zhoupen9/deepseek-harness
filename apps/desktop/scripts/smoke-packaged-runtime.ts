/** Validate the assembled application and its packaged payload. */
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { desktopArtifactOutput, resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { readDesktopRuntime, verifyDesktopRuntime } from '../src/runtime-tree.ts'
import { verifyWindowsCode } from './windows-runtime-signature.mjs'
import { smokePreparedRuntime } from './smoke-prepared-runtime.ts'
import { resolveDesktopPackageTarget } from './package-target.ts'

const paths = resolveDesktopTargetBuildPaths()
const { values } = parseArgs({ options: { unsigned: { type: 'boolean', default: false }, 'skip-notarization': { type: 'boolean', default: false } }, allowPositionals: false })
const target = resolveDesktopBuildTarget()
const windows = target === 'win-x64'
const artifacts = desktopArtifactOutput(paths, { unsigned: values.unsigned, skipNotarization: values['skip-notarization'] }).directory
const linux = target === 'linux-x64'
// electron-builder lays each platform's unpacked application out differently: a
// flat directory on Windows and Linux, a bundle whose payload sits under
// Contents on macOS. Linux keeps Windows' lowercase `resources` convention.
const application = windows ? join(artifacts, 'win-unpacked')
  : linux ? join(artifacts, 'linux-unpacked')
    : join(artifacts, target === 'mac-arm64' ? 'mac-arm64' : 'mac', 'DeepSeek Harness.app', 'Contents')
const resources = join(application, windows || linux ? 'resources' : 'Resources')
const executable = windows ? join(application, 'DeepSeek Harness.exe')
  : linux ? join(application, 'deepseek-harness')
    : join(application, 'MacOS', 'DeepSeek Harness')
const targetSpec = resolveDesktopPackageTarget(target)
const descriptor = await verifyDesktopRuntime(paths.dsh, readDesktopRuntime(paths.dsh).release.version, targetSpec)
if (windows && !values.unsigned) await verifyWindowsCode(application)
// The resource copy carries the sealed descriptor, so verifying it against preparation proves the
// packaged payload is byte-identical to the tree the payload checks were recorded against.
const packaged = await verifyDesktopRuntime(join(resources, 'dsh'), descriptor.release.version, targetSpec)
if (JSON.stringify(packaged) !== JSON.stringify(descriptor)) {
  throw new Error('desktop runtime: packaged payload differs from preparation')
}
await smokePreparedRuntime(join(resources, 'dsh'), executable, join(resources, 'runtime'), descriptor)
