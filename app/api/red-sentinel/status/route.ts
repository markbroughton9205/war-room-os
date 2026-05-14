import { stat } from 'node:fs/promises'
import path from 'node:path'

import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const sup = tryWarRoomSupabase()
  const cwd = process.cwd()
  let scanAvailable = true
  try {
    await stat(path.join(cwd, 'package.json'))
  } catch {
    scanAvailable = false
  }

  let lastScanAt: string | null = null
  let lastFindingsCount = 0
  let lastScanId: string | null = null

  if (sup.ok) {
    const { data, error } = await sup.client
      .from('war_room_sentinel_scans')
      .select('id,created_at,findings_count')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!error && data) {
      lastScanId = data.id ?? null
      lastScanAt = typeof data.created_at === 'string' ? data.created_at : null
      lastFindingsCount = typeof data.findings_count === 'number' ? data.findings_count : 0
    }
  }

  return jsonWithPersistence(
    {
      lastScanAt,
      lastScanId,
      lastFindingsCount,
      scanAvailable,
      persistence: sup.ok,
      config: {
        cwd,
        scanRoots: ['app', 'components', 'lib'],
        maxFiles: 1200,
      },
    },
    sup.ok,
  )
}
