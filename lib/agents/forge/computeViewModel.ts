import type { ComputeView } from './computeView'

/** Plain-language rows for the Foundry panel. Unmeasured stays UNKNOWN; an unplaceable role says why; a simulated node is labelled. */
export type ComputeRow = { id: string; title: string; detail: string }
export function computeViewModel(v: ComputeView): { header: string; nodes: ComputeRow[]; roles: ComputeRow[]; profiles: ComputeRow[]; notes: string[] } {
  const gib = (b: number) => (b / 1024 ** 3).toFixed(1)
  const mib = (n: number | 'UNKNOWN') => (n === 'UNKNOWN' ? 'UNKNOWN' : `${n} MiB`)
  return {
    header: `Compute · ${v.nodes.length} node(s) · ${v.profiles.length} measured profile(s) · decisions below are what the scheduler WOULD place (read-only; the harness still names its own models)`,
    nodes: v.nodes.map(({ record: r, health, runtimeVersion }) => ({
      id: r.nodeId, title: `${r.nodeId} (${r.kind.toLowerCase()}${r.simulated ? ', SIMULATED' : ''}) · ${health}`,
      detail: `${r.hostname} · ${r.cpu.threads} threads · RAM ${r.ramMiB} MiB (${r.load.ramUsedMiB} used) · GPU ${r.gpu.map((g) => `${g.model} ${g.vramMiB} MiB`).join(', ') || 'none'} (${r.load.vramUsedMiB} MiB used) · disk ${gib(r.storage.freeBytes)}/${gib(r.storage.totalBytes)} GiB free · network ${typeof r.networkMbps === 'number' ? r.networkMbps + ' Mb/s' : 'UNKNOWN'} · installed ${r.installedModels.length} · resident ${r.resident.map((m) => m.ref).join(', ') || 'none'}${runtimeVersion ? ' · runtime ' + runtimeVersion : ''}`,
    })),
    roles: v.roles.map(({ role, ranking, placement }) => ({
      id: role, title: `${role.replace(/_/g, ' ').toLowerCase()}: ${placement.ok ? `${placement.modelRef} on ${placement.nodeId}` : 'not placeable'}`,
      detail: placement.ok ? placement.reason : `${placement.reason}${ranking.ranked.length ? ' · evidence: ' + ranking.ranked.map((e) => `${e.ref} ${e.reason}`).join('; ') : ' · no model has benchmark evidence for this role'}`,
    })),
    profiles: v.profiles.map((p) => ({ id: `${p.nodeId}:${p.modelRef}`, title: `${p.modelRef} on ${p.nodeId}`, detail: `${p.quantization} · VRAM ${mib(p.vramRequiredMiB)} · RAM ${mib(p.ramRequiredMiB)} · ${p.residencyClass.toLowerCase().replace('_', ' ')} (${p.basis.toLowerCase()}) · load ${p.loadMs === 'UNKNOWN' ? 'UNKNOWN' : p.loadMs + ' ms'} · ${p.latency.tokensPerSecond === 'UNKNOWN' ? 'UNKNOWN' : p.latency.tokensPerSecond} tok/s · context ${p.contextTokens}` })),
    notes: v.notes,
  }
}
