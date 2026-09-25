import { NextResponse } from 'next/server'
import { isFoundryWorkbenchW0Enabled } from '@/lib/native-builder/foundryWorkbenchW0'
import { foundryWorkbenchStateDir } from '@/lib/native-builder/foundryWorkbenchW0.host'
import {
  loadRegistry,
  mutateExtension,
  openVsxCatalogLabel,
  MICROSOFT_MARKETPLACE_ENABLED,
  type FoundryExtensionSourceType,
} from '@/lib/native-builder/foundryWorkbenchW6'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function snapshot() {
  const stateDir = foundryWorkbenchStateDir()
  const registry = loadRegistry(stateDir)
  return {
    enabled: true,
    openvsxLabel: openVsxCatalogLabel(),
    marketplace: MICROSOFT_MARKETPLACE_ENABLED ? 'YES' : 'MICROSOFT_MARKETPLACE_ENABLED=NO',
    records: registry.records,
    recommendations: registry.recommendations,
    counts: registry.counts,
    host: registry.host,
  }
}

export async function GET() {
  if (!isFoundryWorkbenchW0Enabled()) return NextResponse.json({ enabled: false })
  return NextResponse.json(snapshot())
}

export async function POST(req: Request) {
  if (!isFoundryWorkbenchW0Enabled()) return NextResponse.json({ enabled: false, ok: false })
  const body = await req.json() as {
    action?: string
    extensionId?: string
    commanderApproved?: boolean
    actor?: 'commander' | 'agent'
    vsixPath?: string
    packageDir?: string
    sourceType?: FoundryExtensionSourceType
    nextVsixPath?: string
  }
  const action = body.action === 'review' || body.action === 'approve' || body.action === 'install' || body.action === 'enable' || body.action === 'disable' || body.action === 'update' || body.action === 'remove' || body.action === 'quarantine' || body.action === 'download'
    ? body.action
    : null
  if (!action) return NextResponse.json({ ok: false, code: 'UNKNOWN_ACTION', ...snapshot() }, { status: 400 })
  const result = mutateExtension(foundryWorkbenchStateDir(), {
    action,
    actor: body.actor === 'agent' ? 'agent' : 'commander',
    commanderApproved: body.commanderApproved === true,
    extensionId: body.extensionId,
    vsixPath: body.vsixPath,
    packageDir: body.packageDir,
    sourceType: body.sourceType,
    nextVsixPath: body.nextVsixPath,
  })
  return NextResponse.json({ ...snapshot(), ...result })
}
