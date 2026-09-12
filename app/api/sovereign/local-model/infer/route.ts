import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { runLocalModelInference, type LocalModelProviderType } from '@/lib/sovereign-runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * #22 Phase 11B — Local inference through War Room Core (Next → canonical router → Ollama).
 * No renderer → Ollama privileged path. No auto-download. No paid-provider substitution.
 */
export async function POST(req: Request) {
  const session = await requireCommanderSession('SOVEREIGN_LOCAL_MODEL_INFER')
  if (!session.ok) return session.response

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 })
  }

  const providerRaw = typeof body.provider === 'string' ? body.provider : 'OLLAMA'
  const provider = (
    ['OLLAMA', 'LM_STUDIO', 'LOCAL_OPENAI_COMPATIBLE'].includes(providerRaw)
      ? providerRaw
      : 'OLLAMA'
  ) as LocalModelProviderType

  const result = await runLocalModelInference({
    prompt: typeof body.prompt === 'string' ? body.prompt : '',
    system: typeof body.system === 'string' ? body.system : undefined,
    model: typeof body.model === 'string' ? body.model : null,
    provider,
    ownerUserId: session.userId,
    resourceOwnerUserId:
      typeof body.resource_owner_user_id === 'string' ? body.resource_owner_user_id : session.userId,
    conversationId: typeof body.conversation_id === 'string' ? body.conversation_id : null,
    attemptToolAuthorization: body.attempt_tool_authorization === true,
    attemptDeployAuthorization: body.attempt_deploy_authorization === true,
    attemptPushAuthorization: body.attempt_push_authorization === true,
    attemptFinanceAuthorization: body.attempt_finance_authorization === true,
    attemptAgentSpawn: body.attempt_agent_spawn === true,
    attemptApproveGovernance: body.attempt_approve_governance === true,
    claimIsWrim: body.claim_is_wrim === true,
    claimIsRael: body.claim_is_rael === true,
  })

  return NextResponse.json(
    { ok: result.ok, result },
    { status: result.ok ? 200 : result.status === 'ERROR' || result.status === 'TIMEOUT' ? 422 : 422 },
  )
}
