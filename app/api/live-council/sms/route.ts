import { NextResponse } from 'next/server'
import { getBridgeState, setSmsBridgeEnabled } from '@/lib/live-council-phone-bridge/bridge'
import { getConfiguredWebhookUrl, getTwilioConfig } from '@/lib/live-council-phone-bridge/twilio'
import { requireCommanderSession } from '@/lib/security/commanderSession'

export const dynamic = 'force-dynamic'

async function snapshot() {
  const config = getTwilioConfig()
  return {
    state: await getBridgeState(), provider: 'Twilio', commander: config ? `***-***-${config.commander.slice(-4)}` : null,
    inbound: getConfiguredWebhookUrl() && config ? 'Connected' : 'Blocked', outbound: config ? 'Connected' : 'Blocked',
    currentSmsCouncilThread: 'LIVE_COUNCIL_COMMANDER_SMS', secretsExposed: false,
  }
}
export async function GET() { const commander = await requireCommanderSession('Phone bridge status'); if (!commander.ok) return commander.response; return NextResponse.json(await snapshot()) }
export async function POST(req: Request) {
  const commander = await requireCommanderSession('Phone bridge control'); if (!commander.ok) return commander.response
  const body = await req.json().catch(() => ({})) as { action?: string }
  if (body.action === 'ENABLE') await setSmsBridgeEnabled(true)
  else if (body.action === 'DISABLE') await setSmsBridgeEnabled(false)
  else return NextResponse.json({ error: 'INVALID_ACTION' }, { status: 400 })
  return NextResponse.json(await snapshot())
}
