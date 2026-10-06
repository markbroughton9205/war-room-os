/**
 * Next.js server start hook. Starts ONLY the Agent Foundry scheduler (Phase 10), in the Node.js runtime, never during a
 * production build, and never throwing into server startup. This is deliberately separate from Foundry mission startup
 * recovery and imports no Foundry mission code.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  try {
    const { startAgentScheduler } = await import('@/lib/agents/ops/schedulerBoot')
    startAgentScheduler()
  } catch {
    // scheduler problems must never prevent the server from starting
  }
}
