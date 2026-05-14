import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

export type SentinelFinding = {
  id: string
  severity: 'info' | 'warn' | 'error'
  kind: string
  message: string
  detail?: Record<string, unknown>
}

/** Structured chat / council wiring checks (Red Sentinel category `chat_integrity`). */
export type ChatIntegrityFinding = {
  severity: 'info' | 'warn' | 'error'
  files: string[]
  recommendation: string
  blocksLiveChat: boolean
}

async function runChatIntegrityScan(cwd: string): Promise<ChatIntegrityFinding[]> {
  const out: ChatIntegrityFinding[] = []
  const rel = 'app/page.tsx'
  const pagePath = path.join(cwd, rel)
  let page: string
  try {
    page = await readFile(pagePath, 'utf8')
  } catch {
    out.push({
      severity: 'error',
      files: [rel],
      recommendation: 'Cannot read app/page.tsx.',
      blocksLiveChat: true,
    })
    return out
  }

  const quotedHits = (page.match(/fetch\(\s*['"]\/api\/chat['"]/g) ?? []).length
  const tplHits = (page.match(/fetch\(\s*`\/api\/chat`/g) ?? []).length
  const apiChatHits = quotedHits + tplHits
  if (apiChatHits > 1) {
    out.push({
      severity: 'warn',
      files: [rel],
      recommendation: `Multiple literal fetch('/api/chat') sites (${apiChatHits}) — consolidate via lib/council/liveChatPipeline.postCouncilChat.`,
      blocksLiveChat: false,
    })
  }

  const reducerRefs = page.match(/councilSessionReducer/g)
  if (reducerRefs && reducerRefs.length > 4) {
    out.push({
      severity: 'info',
      files: [rel],
      recommendation: 'Many councilSessionReducer references on the home page — confirm message append stays single-path.',
      blocksLiveChat: false,
    })
  }

  const raelishPlaceholders = (page.match(/placeholder=\{?"[^"]*"/g) ?? []).filter(line =>
    /decree|Speak|Council|Ra|RA'EL|RAEL|War Room|throne/i.test(line),
  )
  if (raelishPlaceholders.length > 2) {
    out.push({
      severity: 'warn',
      files: [rel],
      recommendation: 'Multiple council-style textarea placeholders — risk of competing “primary” composers.',
      blocksLiveChat: false,
    })
  }

  if (/discussionSeconds/.test(page)) {
    out.push({
      severity: 'info',
      files: [rel],
      recommendation: 'discussionSeconds still referenced — verify council timers are wired to current reducer state.',
      blocksLiveChat: false,
    })
  }

  return out
}

function chatIntegrityToSentinelFindings(rows: ChatIntegrityFinding[]): SentinelFinding[] {
  return rows.map((c, i) => ({
    id: `chat-integrity-${i}`,
    severity: c.severity,
    kind: 'chat_integrity',
    message: c.recommendation,
    detail: { files: c.files, blocksLiveChat: c.blocksLiveChat },
  }))
}

const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const MAX_FILES = 1200
const MAX_BYTES_PER_FILE = 200_000
const CONTENT_HASH_PREFIX = 800

function hashSnippet(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim().slice(0, CONTENT_HASH_PREFIX)
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}

async function walkFiles(root: string, acc: string[]): Promise<void> {
  if (acc.length >= MAX_FILES) return
  let entries: string[] = []
  try {
    entries = await readdir(root)
  } catch {
    return
  }
  for (const name of entries) {
    if (acc.length >= MAX_FILES) return
    if (name === 'node_modules' || name === '.next' || name === '.git' || name === 'dist' || name === 'build') {
      continue
    }
    const full = path.join(root, name)
    let st: Awaited<ReturnType<typeof stat>>
    try {
      st = await stat(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      await walkFiles(full, acc)
    } else if (st.isFile() && st.size <= MAX_BYTES_PER_FILE) {
      const ext = path.extname(name).toLowerCase()
      if (TEXT_EXT.has(ext)) {
        acc.push(full)
      }
    }
  }
}

function toPosix(p: string) {
  return p.split(path.sep).join('/')
}

/** `/api/foo/bar` from `.../app/api/foo/bar/route.ts` */
function apiPathFromRouteFile(absPath: string, cwd: string): string | null {
  const rel = toPosix(path.relative(cwd, absPath))
  const m = rel.match(/^app\/api\/(.+)\/route\.(ts|tsx|js|jsx)$/)
  if (!m) return null
  return `/api/${m[1]}`
}

export type RedSentinelScanOptions = {
  /** When set, restrict work. Use `['chat_integrity']` for council wiring only. Include `full` for legacy scan. */
  categories?: string[]
}

export async function runRedSentinelScan(
  cwd: string,
  options?: RedSentinelScanOptions,
): Promise<{ findings: SentinelFinding[]; scannedAt: string; chatIntegrity?: ChatIntegrityFinding[] }> {
  const cats = options?.categories
  const runFull = !cats?.length || cats.includes('full')
  const runCi = !cats?.length || cats.includes('chat_integrity')
  const ciOnly = Boolean(cats?.length && !runFull && runCi)

  const scannedAt = new Date().toISOString()

  if (ciOnly) {
    const chatIntegrity = await runChatIntegrityScan(cwd)
    return {
      findings: chatIntegrityToSentinelFindings(chatIntegrity),
      scannedAt,
      chatIntegrity,
    }
  }

  const findings: SentinelFinding[] = []
  const roots = ['app', 'components', 'lib'].map(r => path.join(cwd, r))

  const files: string[] = []
  for (const r of roots) {
    try {
      await stat(r)
    } catch {
      findings.push({
        id: 'root-missing',
        severity: 'info',
        kind: 'config',
        message: `Scan root not found: ${toPosix(path.relative(cwd, r)) || r}`,
      })
      continue
    }
    await walkFiles(r, files)
  }

  const byHash = new Map<string, string[]>()
  const routeFiles: string[] = []

  for (const file of files) {
    const rel = toPosix(path.relative(cwd, file))
    if (rel.includes('app/api/') && /\/route\.(ts|tsx|js|jsx)$/.test(rel)) {
      routeFiles.push(file)
    }
    let content: string
    try {
      content = await readFile(file, 'utf8')
    } catch {
      continue
    }
    const h = hashSnippet(content)
    const list = byHash.get(h) ?? []
    list.push(rel)
    byHash.set(h, list)
  }

  let dupGroups = 0
  for (const [, paths] of byHash) {
    if (paths.length < 2) continue
    if (dupGroups >= 25) break
    dupGroups++
    const uniq = [...new Set(paths)].sort()
    findings.push({
      id: `dup-${hashSnippet(uniq.join('|'))}`,
      severity: 'warn',
      kind: 'duplicate_snippet',
      message: `Similar file prefix hash matches ${uniq.length} files (first ${CONTENT_HASH_PREFIX} chars normalized).`,
      detail: { paths: uniq.slice(0, 12), total: uniq.length },
    })
  }

  const statusRoutes = routeFiles.filter(f => {
    const rel = toPosix(path.relative(cwd, f))
    return /\/status\/route\.(ts|tsx)$/.test(rel)
  })
  if (statusRoutes.length > 1) {
    findings.push({
      id: 'overlap-status-routes',
      severity: 'info',
      kind: 'route_name_overlap',
      message: `Multiple API routes named "status" under different paths (${statusRoutes.length}).`,
      detail: {
        paths: statusRoutes.map(f => toPosix(path.relative(cwd, f))).slice(0, 30),
      },
    })
  }

  let staleRoutes = 0
  for (const rf of routeFiles) {
    if (staleRoutes >= 35) break
    const apiPath = apiPathFromRouteFile(rf, cwd)
    if (!apiPath) continue
    let usedElsewhere = false
    for (const other of files) {
      if (other === rf) continue
      let txt: string
      try {
        txt = await readFile(other, 'utf8')
      } catch {
        continue
      }
      if (txt.includes(apiPath)) {
        usedElsewhere = true
        break
      }
    }
    if (!usedElsewhere) {
      staleRoutes++
      findings.push({
        id: `stale-${apiPath}`,
        severity: 'info',
        kind: 'possibly_orphan_api',
        message: `No references to ${apiPath} found outside its route file (heuristic).`,
        detail: { routeFile: toPosix(path.relative(cwd, rf)) },
      })
    }
  }

  const clientSurface = files.filter(f => {
    const rel = toPosix(path.relative(cwd, f))
    return rel.startsWith('app/') || rel.startsWith('components/')
  })

  for (const file of clientSurface) {
    const rel = toPosix(path.relative(cwd, file))
    if (/\.(test|spec)\.(tsx|ts|jsx|js)$/.test(rel)) continue
    let content: string
    try {
      content = await readFile(file, 'utf8')
    } catch {
      continue
    }
    if (/service_role/i.test(content)) {
      findings.push({
        id: `svc-${rel}`,
        severity: 'error',
        kind: 'unsafe_service_role',
        message: `Possible service_role reference in client-surface file.`,
        detail: { file: rel },
      })
    }
  }

  let onlineHits = 0
  for (const file of files) {
    const rel = toPosix(path.relative(cwd, file))
    if (/\.(test|spec)\.(tsx|ts|jsx|js)$/.test(rel)) continue
    let content: string
    try {
      content = await readFile(file, 'utf8')
    } catch {
      continue
    }
    const lines = content.split('\n')
    lines.forEach((line, idx) => {
      if (onlineHits >= 40) return
      if (!/['"]ONLINE['"]/.test(line)) return
      if (/process\.env|getenv|fromEnv|typeof\s+\w+\s*===/.test(line)) return
      if (/\?\./.test(line)) return
      onlineHits++
      findings.push({
        id: `online-${rel}-${idx + 1}`,
        severity: 'warn',
        kind: 'hardcoded_online',
        message: `Quoted ONLINE literal — verify it reflects a real connectivity check.`,
        detail: { file: rel, line: idx + 1, sample: line.trim().slice(0, 160) },
      })
    })
  }

  let chatIntegrity: ChatIntegrityFinding[] | undefined
  if (runCi) {
    chatIntegrity = await runChatIntegrityScan(cwd)
    findings.push(...chatIntegrityToSentinelFindings(chatIntegrity))
  }

  return { findings, scannedAt, chatIntegrity }
}
