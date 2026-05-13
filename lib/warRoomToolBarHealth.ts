import type { ToolId } from '@/lib/tools/toolRegistry'

export type ToolBarLabel =
  | '—'
  | 'ONLINE'
  | 'STANDBY'
  | 'COMPLETE'
  | 'PARTIAL'
  | 'CONFIG NEEDED'
  | 'NOT CONNECTED'
  | 'SCANNING'
  | 'ACTIVE'
  | 'ERROR'

const INITIAL: Record<ToolId, ToolBarLabel> = {
  web: '—',
  memory: '—',
  files: '—',
  research: '—',
  repo: '—',
  deployments: '—',
  build: '—',
}

export function initialToolBarHealth(): Record<ToolId, ToolBarLabel> {
  return { ...INITIAL }
}

export async function fetchToolBarHealth(): Promise<Record<ToolId, ToolBarLabel>> {
  const next: Record<ToolId, ToolBarLabel> = { ...INITIAL }

  const [
    memoryRes,
    filesRes,
    webRes,
    researchRes,
    repoRes,
    deployRes,
    buildRes,
  ] = await Promise.all([
    fetch('/api/tools/memory?health=1', { cache: 'no-store' }),
    fetch('/api/files?health=1', { cache: 'no-store' }),
    fetch('/api/tools/web', { cache: 'no-store' }),
    fetch('/api/tools/research', { cache: 'no-store' }),
    fetch('/api/repo/scan?health=1', { cache: 'no-store' }),
    fetch('/api/tools/deployments', { cache: 'no-store' }),
    fetch('/api/build-requests', { cache: 'no-store' }),
  ])

  try {
    const j = await memoryRes.json()
    if (memoryRes.ok && j.healthy) {
      next.memory = 'ONLINE'
    } else {
      next.memory = 'ERROR'
    }
  } catch {
    next.memory = 'ERROR'
  }

  try {
    const j = await filesRes.json()
    if (!filesRes.ok) {
      next.files = 'ERROR'
    } else if (j.configured && j.bucketReady && j.tableReady) {
      next.files = j.uploading ? 'ACTIVE' : 'ONLINE'
    } else {
      next.files = 'CONFIG NEEDED'
    }
  } catch {
    next.files = 'ERROR'
  }

  try {
    const j = await webRes.json()
    if (!webRes.ok) {
      next.web = 'ERROR'
    } else if (j.tavilyConfigured) {
      next.web = 'STANDBY'
    } else {
      next.web = 'CONFIG NEEDED'
    }
  } catch {
    next.web = 'ERROR'
  }

  try {
    const j = await researchRes.json()
    if (!researchRes.ok) {
      next.research = 'ERROR'
    } else if (j.status === 'config_needed') {
      next.research = 'CONFIG NEEDED'
    } else if (j.status === 'partial') {
      next.research = 'PARTIAL'
    } else {
      next.research = 'STANDBY'
    }
  } catch {
    next.research = 'ERROR'
  }

  try {
    const j = await repoRes.json()
    if (!repoRes.ok) {
      next.repo = 'ERROR'
    } else if (j.scanning) {
      next.repo = 'SCANNING'
    } else {
      next.repo = 'ONLINE'
    }
  } catch {
    next.repo = 'ERROR'
  }

  try {
    const j = await deployRes.json()
    if (!deployRes.ok) {
      next.deployments = 'ERROR'
    } else if (j.connected) {
      next.deployments = 'STANDBY'
    } else {
      next.deployments = 'NOT CONNECTED'
    }
  } catch {
    next.deployments = 'ERROR'
  }

  next.build = buildRes.ok ? 'ONLINE' : 'ERROR'

  return next
}
