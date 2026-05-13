import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'

type RepoFile = {
  relativePath: string
  extension: string
}

const SCAN_ROOTS = ['app', 'components', 'lib', 'supabase']

async function pathExists(target: string) {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

async function walkDirectory(root: string, current: string, files: RepoFile[]) {
  const entries = await readdir(current, { withFileTypes: true })

  await Promise.all(entries.map(async entry => {
    const absolutePath = path.join(current, entry.name)
    if (entry.isDirectory()) {
      await walkDirectory(root, absolutePath, files)
      return
    }

    if (!entry.isFile()) return

    const relativePath = path.relative(root, absolutePath).replaceAll(path.sep, '/')
    files.push({
      relativePath,
      extension: path.extname(entry.name).replace('.', '').toLowerCase() || 'none',
    })
  }))
}

async function collectFiles(repoRoot: string) {
  const files: RepoFile[] = []

  for (const scanRoot of SCAN_ROOTS) {
    const absoluteRoot = path.join(repoRoot, scanRoot)
    if (await pathExists(absoluteRoot)) {
      await walkDirectory(repoRoot, absoluteRoot, files)
    }
  }

  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

function routeFromPageFile(relativePath: string) {
  if (/^app\/page\.(tsx|ts|jsx|js)$/.test(relativePath)) return '/'

  const withoutApp = relativePath.replace(/^app\//, '').replace(/\/page\.(tsx|ts|jsx|js)$/, '')
  const segments = withoutApp
    .split('/')
    .filter(segment => segment && !segment.startsWith('(') && !segment.endsWith(')'))

  return `/${segments.join('/')}`.replace(/\/$/, '') || '/'
}

function apiRouteFromFile(relativePath: string) {
  const withoutApp = relativePath.replace(/^app\//, '').replace(/\/route\.(tsx|ts|jsx|js)$/, '')
  return `/${withoutApp}`.replace(/\/$/, '')
}

function extensionCounts(files: RepoFile[]) {
  return files.reduce<Record<string, number>>((counts, file) => {
    counts[file.extension] = (counts[file.extension] ?? 0) + 1
    return counts
  }, {})
}

async function readTextIfExists(repoRoot: string, relativePath: string) {
  try {
    return await readFile(path.join(repoRoot, relativePath), 'utf8')
  } catch {
    return ''
  }
}

function detectFeatures(files: RepoFile[], searchableText: string) {
  const fileSet = new Set(files.map(file => file.relativePath))

  return [
    { name: 'Memory', detected: fileSet.has('app/api/tools/memory/route.ts') || searchableText.includes('MemoryPanel') },
    { name: 'Opportunity Scout', detected: fileSet.has('app/api/income/scout/route.ts') || searchableText.includes('OpportunityScoutPanel') },
    { name: 'Action Queue', detected: fileSet.has('app/api/actions/route.ts') || searchableText.includes('NeedsRaelPanel') },
    { name: 'Files Vault', detected: fileSet.has('app/api/files/upload/route.ts') || searchableText.includes('FilesEvidenceVaultPanel') },
    { name: 'Baby AI', detected: fileSet.has('app/baby/page.tsx') || fileSet.has('app/api/baby/chat/route.ts') },
    { name: 'SMS Bridge', detected: fileSet.has('app/api/sms/send/route.ts') || searchableText.includes('SmsBridgePanel') },
    { name: 'Payments/Payouts', detected: searchableText.includes('PaymentsPayoutsPanel') },
    { name: 'Grok integration placeholders', detected: fileSet.has('app/api/income/grok/route.ts') || searchableText.includes('GROK') },
  ].filter(feature => feature.detected)
}

async function readGitInfo(repoRoot: string) {
  const head = await readTextIfExists(repoRoot, '.git/HEAD')
  const branch = head.startsWith('ref:')
    ? head.replace('ref:', '').trim().replace('refs/heads/', '')
    : head.trim().slice(0, 12) || 'unknown'
  const logs = await readTextIfExists(repoRoot, '.git/logs/HEAD')
  const latestCommits = logs
    .trim()
    .split('\n')
    .filter(Boolean)
    .slice(-5)
    .reverse()
    .map(line => {
      const [metadata, message = ''] = line.split('\t')
      const parts = metadata.split(' ')
      const hash = parts[1] ?? ''
      const timezone = parts.at(-1) ?? ''
      const timestamp = Number(parts.at(-2) ?? 0)
      const author = parts.slice(2, -2).join(' ').replace(/<[^>]+>/, '').trim()

      return {
        hash: hash.slice(0, 7),
        message: message.replace(/^commit:\s*/, ''),
        author,
        date: timestamp ? new Date(timestamp * 1000).toISOString() : null,
        timezone,
      }
    })

  return { branch, latestCommits }
}

async function scanRepo() {
  const repoRoot = process.cwd()
  const started = Date.now()
  const files = await collectFiles(repoRoot)
  const appSource = await readTextIfExists(repoRoot, 'app/page.tsx')
  const babySource = await readTextIfExists(repoRoot, 'app/baby/page.tsx')
  const { branch, latestCommits } = await readGitInfo(repoRoot)
  const routes = files
    .filter(file => /^app\/.+\/page\.(tsx|ts|jsx|js)$/.test(file.relativePath) || /^app\/page\.(tsx|ts|jsx|js)$/.test(file.relativePath))
    .map(file => routeFromPageFile(file.relativePath))
  const apiRoutes = files
    .filter(file => /^app\/api\/.+\/route\.(tsx|ts|jsx|js)$/.test(file.relativePath))
    .map(file => apiRouteFromFile(file.relativePath))

  return {
    repoStatus: 'read-only indexed',
    totalFilesIndexed: files.length,
    routes,
    apiRoutes,
    extensionCounts: extensionCounts(files),
    features: detectFeatures(files, `${appSource}\n${babySource}`),
    latestCommits,
    currentBranch: branch,
    lastScanTime: new Date().toISOString(),
    scanStatus: 'indexed',
    buildStatus: 'placeholder: not connected',
    deploymentStatus: 'placeholder: not connected',
    architectureMap: SCAN_ROOTS.map(scanRoot => ({
      module: scanRoot,
      fileCount: files.filter(file => file.relativePath.startsWith(`${scanRoot}/`)).length,
    })),
    restrictions: [
      'read/analyze only',
      'no code execution',
      'no auto-modification',
      'no autonomous commits',
      'no shell command execution from UI',
    ],
    durationMs: Date.now() - started,
  }
}

export async function GET() {
  return POST()
}

export async function POST() {
  try {
    const scan = await scanRepo()
    return NextResponse.json({ tool: 'repo-awareness', status: 'complete', scan })
  } catch (error) {
    return NextResponse.json({
      tool: 'repo-awareness',
      status: 'error',
      message: error instanceof Error ? error.message : 'Repo scan failed',
    }, { status: 500 })
  }
}
