/**
 * Development-time license manifest for the destruction previs kernel.
 * Nothing in this list is integrated unless integrationMode is NATIVE or an existing repo dependency.
 * Frostbite and Unreal Chaos are reference-only and are not imported.
 */
export const DESTRUCTION_LICENSE_MANIFEST = [
  {
    name: 'HVS Destruction Previs Kernel',
    version: '1.0.0',
    license: 'HVS-owned',
    source: 'lib/media-command/destruction',
    integrationMode: 'NATIVE',
    noticesRequired: false,
  },
  {
    name: 'three',
    version: '0.184.0',
    license: 'MIT',
    source: 'existing package.json dependency',
    integrationMode: 'VIEWPORT_ONLY',
    noticesRequired: true,
  },
  {
    name: 'FFmpeg',
    version: 'bundled HVS media-command tool',
    license: 'existing HVS toolchain (LGPL-prefer policy)',
    source: 'application-data/media-command/tools/ffmpeg',
    integrationMode: 'SUBPROCESS_EXISTING',
    noticesRequired: true,
  },
  {
    name: 'Frostbite',
    version: 'n/a',
    license: 'PROPRIETARY',
    source: 'REFERENCE_ONLY',
    integrationMode: 'NOT_INTEGRATED',
    noticesRequired: false,
  },
  {
    name: 'Unreal Chaos',
    version: 'n/a',
    license: 'PROPRIETARY',
    source: 'REFERENCE_ONLY',
    integrationMode: 'NOT_INTEGRATED',
    noticesRequired: false,
  },
  {
    name: 'NVIDIA Blast',
    version: 'n/a',
    license: 'NOT_INTEGRATED',
    source: 'not installed',
    integrationMode: 'NOT_INTEGRATED',
    noticesRequired: false,
  },
] as const

export function licenseManifestAllowsIntegration(): boolean {
  // Read as plain strings: an entry added later with an unresolved license must still fail this gate.
  const entries: ReadonlyArray<{ license: string; integrationMode: string }> = DESTRUCTION_LICENSE_MANIFEST
  return entries.every(entry => entry.license !== 'UNKNOWN' && entry.integrationMode !== 'UNKNOWN')
}
