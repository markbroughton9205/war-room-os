/**
 * Compact repository map — never dump a whole tree into model context.
 */
import { access, readFile } from 'node:fs/promises'
import { constants as FsConstants } from 'node:fs'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { listRepoFiles } from './repositoryInspector'
import { getRepoGitContext } from './repositoryInspector'

export type RepoMap = {
  root: string
  importantDirectories: string[]
  entryPoints: string[]
  framework: string
  runtime: string
  dependencies: string[]
  testCommands: string[]
  buildCommands: string[]
  lintCommands: string[]
  typecheckCommands: string[]
  fileCount: number
  gitBranch?: string
  architectureNotes: string[]
}

async function exists(rel: string): Promise<boolean> {
  try {
    await access(path.join(resolveRepoRoot(), rel), FsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function buildRepoMap(): Promise<RepoMap> {
  const root = resolveRepoRoot()
  const files = await listRepoFiles()
  const dirs = new Set<string>()
  for (const file of files.slice(0, 800)) {
    const dir = file.split('/')[0]
    if (dir) dirs.add(dir)
  }

  type PkgJson = { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> }
  let pkg: PkgJson | null = null
  if (await exists('package.json')) {
    try {
      pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as PkgJson
    } catch {
      pkg = null
    }
  }

  const deps = Object.keys({ ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) }).slice(0, 40)
  const scripts = pkg?.scripts ?? {}
  const framework = deps.includes('next')
    ? 'next'
    : deps.includes('react')
      ? 'react'
      : (await exists('Cargo.toml'))
        ? 'rust'
        : (await exists('pyproject.toml') || await exists('requirements.txt'))
          ? 'python'
          : pkg
            ? 'node'
            : 'unknown'

  const entryPoints = ['package.json', 'index.js', 'index.mjs', 'server.mjs', 'src/index.ts', 'app/page.tsx', 'main.py']
    .filter(rel => files.includes(rel) || files.some(f => f === rel))

  let gitBranch: string | undefined
  try {
    gitBranch = (await getRepoGitContext()).status.currentBranch
  } catch {
    gitBranch = undefined
  }

  return {
    root,
    importantDirectories: [...dirs].slice(0, 30),
    entryPoints,
    framework,
    runtime: framework === 'python' ? 'python' : framework === 'rust' ? 'cargo' : 'node',
    dependencies: deps,
    testCommands: [scripts.test, scripts['test:unit']].filter(Boolean) as string[],
    buildCommands: [scripts.build].filter(Boolean) as string[],
    lintCommands: [scripts.lint].filter(Boolean) as string[],
    typecheckCommands: scripts.typecheck ? [scripts.typecheck] : (await exists('tsconfig.json') ? ['tsc --noEmit'] : []),
    fileCount: files.length,
    gitBranch,
    architectureNotes: [
      files.length === 0 ? 'Empty workspace — greenfield.' : `Mapped ${files.length} files (denylist applied).`,
    ],
  }
}
