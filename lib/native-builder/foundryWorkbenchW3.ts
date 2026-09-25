/**
 * Foundry Workbench W3 — Commander terminal + live diagnostics.
 * Extends W2. Does not rebuild Tool Broker, Model Router, or Workbench substrate.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { redactSecretLikeText } from './foundrySensitivePathGuard'
import { buildFoundryEditorContextEnvelope, type FoundryEditorContextEnvelope } from './foundryEditorContext'
import { composeInstructionContext, loadProjectInstructionSources } from './foundryProjectInstructions'
import { ensureFoundryWorkbenchW2Fixture, envelopeFromDiskFile } from './foundryWorkbenchW2'

export const FOUNDRY_W3_COMMANDS = [
  'foundry.attachTerminalOutput',
  'foundry.explainDiagnostic',
  'foundry.fixDiagnostic',
  'foundry.openProblems',
  'foundry.newTerminal',
] as const

export function ensureFoundryWorkbenchW3Fixture(root?: string): string {
  const folder = ensureFoundryWorkbenchW2Fixture(root)
  mkdirSync(folder, { recursive: true })
  if (!existsSync(path.join(folder, 'tsconfig.json'))) {
    writeFileSync(path.join(folder, 'tsconfig.json'), `${JSON.stringify({
      compilerOptions: { strict: true, target: 'ES2020', module: 'ESNext', skipLibCheck: true, noEmit: true },
      include: ['*.ts'],
    }, null, 2)}\n`)
  }
  const broken = path.join(folder, 'broken.ts')
  if (!existsSync(broken)) {
    writeFileSync(broken, [
      'export function add(a: number, b: number): number {',
      '  return a + b',
      '}',
      '',
      'export const count: number = "wrong"',
      'export const total = add(count, 1)',
      '',
    ].join('\n'))
  }
  if (!existsSync(path.join(folder, '.foundry', 'instructions.md'))) {
    mkdirSync(path.join(folder, '.foundry'), { recursive: true })
    writeFileSync(path.join(folder, '.foundry', 'instructions.md'), 'Prefer typed numeric literals. Do not weaken types with any.\n')
  }
  return folder
}

export function envelopeForBrokenTs(workspaceRoot: string, extras?: Partial<FoundryEditorContextEnvelope>): FoundryEditorContextEnvelope {
  const rel = 'broken.ts'
  const abs = path.join(workspaceRoot, rel)
  const content = existsSync(abs) ? readFileSync(abs, 'utf8') : ''
  const lines = content.split('\n')
  const idx = Math.max(0, lines.findIndex(line => line.includes('const count')))
  const line = lines[idx] || ''
  const diagnostic = {
    diagnosticId: 'w3-count-type',
    file: rel,
    message: "Type 'string' is not assignable to type 'number'.",
    severity: 'error' as const,
    source: 'ts',
    code: '2322',
    startLine: idx + 1,
    startColumn: 1,
    endLine: idx + 1,
    endColumn: line.length + 1,
  }
  return buildFoundryEditorContextEnvelope({
    workspaceRoot,
    projectId: 'w3-workbench',
    workspaceId: 'w3-workbench',
    activeFile: rel,
    activeLanguageId: 'typescript',
    cursor: { line: idx + 1, column: Math.max(1, line.indexOf('"wrong"') + 1) },
    selection: { startLine: idx + 1, startColumn: 1, endLine: idx + 1, endColumn: line.length + 1, text: line },
    nearbyLines: lines.slice(Math.max(0, idx - 2), idx + 3).join('\n'),
    activeSymbol: 'count',
    openTabs: [{ path: rel, languageId: 'typescript' }],
    visibleDiagnostics: [diagnostic, ...(extras?.visibleDiagnostics ?? [])],
    fileContent: content,
    providerClass: extras?.sensitive?.providerClass ?? 'local',
    terminalTail: extras?.terminalTail,
    terminalSession: extras?.terminalSession,
  })
}

export function projectInstructionExcerpt(workspaceRoot: string, commanderInstruction?: string): string {
  return composeInstructionContext(loadProjectInstructionSources({
    projectRoot: workspaceRoot,
    commanderInstruction,
  })).slice(0, 1500)
}

export function redactTerminalAttach(raw: string, providerClass: 'none' | 'local' | 'remote' = 'remote'): {
  text: string
  redactionOccurred: boolean
  leakCount: number
  lineCount: number
  byteCount: number
} {
  const text = redactSecretLikeText(raw).split('\n').slice(-80).join('\n')
  const leakCount = providerClass === 'remote' && /ghp_|sk_live_|sk_test_|Bearer\s+[A-Za-z0-9._-]{12,}/i.test(text) ? 1 : 0
  return {
    text,
    redactionOccurred: text !== raw,
    leakCount,
    lineCount: text.split('\n').length,
    byteCount: Buffer.byteLength(text, 'utf8'),
  }
}

export function adapterInjectionPathCount(adapterSource: string): number {
  const withoutCommanderGated = adapterSource.replace(
    /commanderAuthorized[\s\S]{0,500}?\.sendText\s*\([^)]*\)/g,
    'commanderAuthorized',
  )
  const hits = withoutCommanderGated.match(/\.sendText\s*\(|executeCommand\(\s*['"]workbench\.action\.terminal\.send/g)
  return hits ? hits.length : 0
}

export function w3FixtureRoot(): string {
  return path.join(os.homedir(), 'FoundryProjects', 'w0-workbench-spike')
}

export { envelopeFromDiskFile }
