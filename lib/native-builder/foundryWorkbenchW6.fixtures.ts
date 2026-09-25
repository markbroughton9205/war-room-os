/**
 * Disposable W6 proof extensions. Not production marketplace packages.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { packVsix } from './foundryWorkbenchW6'

function writeExt(root: string, pkg: Record<string, unknown>, js: string) {
  mkdirSync(root, { recursive: true })
  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)
  writeFileSync(path.join(root, 'extension.js'), js)
  return root
}

const pingJs = (readyName: string, id: string) => `'use strict'
const vscode = require('vscode')
const fs = require('node:fs')
const path = require('node:path')
function activate(context) {
  context.subscriptions.push(vscode.commands.registerCommand('${id}.ping', () => 'ok'))
  try {
    const candidates = [
      path.join(path.dirname(context.extensionPath), 'foundry-bridge.json'),
      path.join(context.extensionPath, 'foundry-bridge.json'),
    ]
    let stateDir = ''
    for (const file of candidates) {
      try { stateDir = JSON.parse(fs.readFileSync(file, 'utf8')).stateDir; if (stateDir) break } catch { /* next */ }
    }
    if (stateDir) {
      fs.writeFileSync(path.join(stateDir, '${readyName}'), JSON.stringify({
        extensionId: '${id}',
        host: 'extension-host',
        at: new Date().toISOString(),
        pid: process.pid,
      }, null, 2))
    }
  } catch { /* proof best-effort */ }
}
function deactivate() {}
module.exports = { activate, deactivate }
`

export function writeLintFixture(root?: string) {
  const dir = root || path.join(os.tmpdir(), `w6-lint-${process.pid}`)
  return writeExt(dir, {
    name: 'w6-lint-fixture',
    displayName: 'Foundry W6 Lint Fixture',
    description: 'Disposable linter-class fixture for governed extension proof.',
    version: '1.0.0',
    publisher: 'foundry',
    license: 'MIT',
    engines: { vscode: '^1.90.0' },
    activationEvents: ['onStartupFinished'],
    main: './extension.js',
    contributes: {
      commands: [{ command: 'foundry.w6-lint-fixture.ping', title: 'Foundry W6 Lint Ping' }],
      linters: [{ language: 'javascript' }],
    },
  }, pingJs('w6-lint-ready.json', 'foundry.w6-lint-fixture'))
}

export function writeLintFixtureV2(root?: string) {
  const dir = root || path.join(os.tmpdir(), `w6-lint-v2-${process.pid}`)
  const pkgDir = writeLintFixture(dir)
  const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) as Record<string, unknown>
  pkg.version = '1.1.0'
  writeFileSync(path.join(pkgDir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)
  return pkgDir
}

export function writeLanguageFixture(root?: string) {
  const dir = root || path.join(os.tmpdir(), `w6-lang-${process.pid}`)
  return writeExt(dir, {
    name: 'w6-language-fixture',
    displayName: 'Foundry W6 Language Fixture',
    description: 'Disposable language-data fixture for governed extension proof.',
    version: '1.0.0',
    publisher: 'foundry',
    license: 'Apache-2.0',
    engines: { vscode: '^1.90.0' },
    activationEvents: ['onStartupFinished'],
    main: './extension.js',
    contributes: {
      languages: [{ id: 'foundryw6', aliases: ['FoundryW6'], extensions: ['.fw6'] }],
      commands: [{ command: 'foundry.w6-language-fixture.ping', title: 'Foundry W6 Language Ping' }],
    },
  }, pingJs('w6-language-ready.json', 'foundry.w6-language-fixture'))
}

export function writeUnsafeFixture(root?: string) {
  const dir = root || path.join(os.tmpdir(), `w6-unsafe-${process.pid}`)
  return writeExt(dir, {
    name: 'w6-unsafe-fixture',
    displayName: 'Foundry W6 Unsafe Fixture',
    description: 'Disposable suspicious fixture. Must not auto-install.',
    version: '0.0.1',
    publisher: 'foundry',
    license: 'UNKNOWN',
    engines: { vscode: '^1.90.0' },
    scripts: { postinstall: 'node -e "process.exit(0)"' },
    activationEvents: ['onStartupFinished'],
    main: './extension.js',
    contributes: {
      commands: [{ command: 'foundry.w6-unsafe-fixture.shell', title: 'Foundry W6 Unsafe Shell' }],
    },
    foundryNetworkBootstrap: 'https://example.invalid/bootstrap',
  }, pingJs('w6-unsafe-ready.json', 'foundry.w6-unsafe-fixture'))
}

export function packLintVsix(outDir: string) {
  const src = writeLintFixture(path.join(outDir, 'src-lint'))
  return packVsix(src, path.join(outDir, 'foundry.w6-lint-fixture-1.0.0.vsix'))
}

export function packLintVsixV2(outDir: string) {
  const src = writeLintFixtureV2(path.join(outDir, 'src-lint-v2'))
  return packVsix(src, path.join(outDir, 'foundry.w6-lint-fixture-1.1.0.vsix'))
}

export function packLanguageVsix(outDir: string) {
  const src = writeLanguageFixture(path.join(outDir, 'src-lang'))
  return packVsix(src, path.join(outDir, 'foundry.w6-language-fixture-1.0.0.vsix'))
}
