import { NextResponse } from 'next/server'
import { probeOllama } from '@/lib/native-builder/ollamaClient'
import { NATIVE_TERMINAL_OPERATION_IDS } from '@/lib/native-builder/types'
import { countUnresolvedIssues } from '@/lib/native-builder/storage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const [ollama, unresolvedIssueCount] = await Promise.all([probeOllama(), countUnresolvedIssues()])
  return NextResponse.json({
    localModel: ollama,
    terminalOperations: NATIVE_TERMINAL_OPERATION_IDS,
    unresolvedIssueCount,
    guardrails: {
      externalEscalationDefault: false,
      autoCommitCapable: false,
      autoPushCapable: false,
      autoDeployCapable: false,
      rawShellCapable: false,
    },
  })
}
