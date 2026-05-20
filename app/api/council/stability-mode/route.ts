import { NextResponse } from 'next/server'
import { toOperatorNextStepsPayload } from '@/lib/operator/nextStepsReport'
import { buildStabilityModeOperatorNextSteps } from '@/lib/operator/repairPacketNextSteps'
import { isCouncilStabilityMode, stabilityModeResponseMeta } from '@/lib/council/stabilityMode'

export async function GET() {
  const active = isCouncilStabilityMode()
  const operatorPayload = toOperatorNextStepsPayload(buildStabilityModeOperatorNextSteps(active))

  return NextResponse.json({
    active,
    ...stabilityModeResponseMeta(),
    operatorNextSteps: operatorPayload.report,
    operatorNextStepsMarkdown: operatorPayload.markdown,
  })
}
