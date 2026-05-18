import { NextResponse } from 'next/server'

import { getProviderRuntimeHealth } from '@/lib/providers/health'
import { listPersistedSignalSnapshot } from '@/lib/signals'
import { getLastOrchestrationStepResult } from '@/lib/war-room/diagnostics'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const [providers, signals] = await Promise.all([
    getProviderRuntimeHealth(),
    listPersistedSignalSnapshot(1),
  ])

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    providerStatusSource: '/api/runtime/canonical-status',
    babyProviderBindingSource: '/api/runtime/canonical-status',
    signalMigrationStatus: signals.migrationStatus,
    signalPersistenceNote: signals.persistenceNote,
    lastOrchestrationStepResult: getLastOrchestrationStepResult(),
    latestTaskPacketSource: '/api/engineering/task-packet',
    observerLearningStatus: 'observe_propose_only',
    providers: providers.providers.map(provider => ({
      id: provider.id,
      provider: provider.provider,
      health: provider.health,
      configured: provider.configured,
    })),
    guardrails: {
      apiKeysSerialized: false,
      browserShellExecution: false,
      browserFileMutation: false,
      browserDeployment: false,
      hiddenBackgroundActions: false,
    },
  }, {
    headers: { 'cache-control': 'no-store' },
  })
}
