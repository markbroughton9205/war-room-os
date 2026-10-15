/**
 * Council <-> Foundry on one GPU. The local GPU holds ONE resident model: a Foundry engineering mission keeps its builder resident,
 * and a Council model turn would evict it (and be evicted in turn). Rule: while a live Foundry mission is executing, Council model
 * turns are DEFERRED with an honest notice; everything Council can answer without the local model (self-knowledge, recall, subsystem
 * state, browsing) keeps working. Policy WAR_ROOM_COUNCIL_GPU_POLICY=ALLOW turns the deferral off (Commander decision, per install).
 */
export type ActiveFoundryMission = { id: string; title: string; state: string; stateReason: string }
export type GpuPolicy = 'DEFER' | 'ALLOW'

export function gpuPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): GpuPolicy {
  return env.WAR_ROOM_COUNCIL_GPU_POLICY?.trim().toUpperCase() === 'ALLOW' ? 'ALLOW' : 'DEFER'
}

export type GpuDecision =
  | { run: true; reason: string; holder: null }
  | { run: false; reason: string; holder: ActiveFoundryMission }

export function decideCouncilModelTurn(input: { policy: GpuPolicy; activeMission: ActiveFoundryMission | null }): GpuDecision {
  if (!input.activeMission) return { run: true, reason: 'no Foundry mission is using the local GPU', holder: null }
  if (input.policy === 'ALLOW') return { run: true, reason: `policy ALLOW: running alongside Foundry mission ${input.activeMission.id}`, holder: null }
  return {
    run: false,
    reason: `Foundry mission ${input.activeMission.id} ("${input.activeMission.title}") is ${input.activeMission.state.toLowerCase()} and holds the local GPU`,
    holder: input.activeMission,
  }
}

export function deferralNotice(d: Extract<GpuDecision, { run: false }>): string {
  return [
    `Council is holding this one: ${d.reason}.`,
    'A Council model turn now would evict Foundry\'s resident builder and stall the mission, so no member was called and nothing was run.',
    'Questions Council can answer without the local model (what War Room is, what was said earlier, subsystem status, opening a page) still work.',
    'Send this again when the mission finishes, or cancel the mission from the Foundry missions panel.',
  ].join('\n')
}
