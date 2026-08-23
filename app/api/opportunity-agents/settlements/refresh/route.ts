import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { runSettlementCorroboration, type SettlementSource } from '@/lib/settlement-intelligence/corroborationPipeline'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function parseSource(value: unknown): SettlementSource | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { provider?: unknown; url?: unknown }
  if (candidate.provider !== 'settlesignal' && candidate.provider !== 'classaction_org') return null
  if (typeof candidate.url !== 'string') return null
  try {
    const url = new URL(candidate.url)
    const expectedHost = candidate.provider === 'settlesignal' ? 'settlesignal.com' : 'www.classaction.org'
    if (url.protocol !== 'https:' || url.hostname !== expectedHost) return null
    return { provider: candidate.provider, url: url.toString() }
  } catch { return null }
}

export async function POST(req: Request) {
  const commander = await requireCommanderSession('Settlement intelligence refresh')
  if (!commander.ok) return commander.response
  const body = await req.json().catch(() => ({})) as { sources?: unknown }
  const requested = Array.isArray(body.sources) ? body.sources : []
  const sources = requested.map(parseSource).filter((source): source is SettlementSource => source !== null)
  if (!sources.length || sources.length !== requested.length) return NextResponse.json({ status: 'error', error: 'Provide valid SettleSignal or ClassAction.org HTTPS record URLs.' }, { status: 400 })
  try {
    const result = await runSettlementCorroboration(sources)
    return NextResponse.json({ tool: 'REFRESH_SETTLEMENT_INTELLIGENCE', status: 'complete', ...result, secretsExposed: false, claimsSubmitted: false })
  } catch (error) {
    return NextResponse.json({ tool: 'REFRESH_SETTLEMENT_INTELLIGENCE', status: 'error', error: error instanceof Error ? error.message : 'Settlement refresh failed.', discoveryOnly: true, claimsSubmitted: false }, { status: 502 })
  }
}
