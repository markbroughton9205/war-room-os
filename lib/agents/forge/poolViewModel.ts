import type { PoolView } from './poolView'

/** Plain-language rows for the Foundry panel. UNKNOWN stays UNKNOWN; a missing model is "not assigned", never a default. */
export type PoolRow = { id: string; title: string; detail: string }
export function poolViewModel(v: PoolView): { header: string; roles: PoolRow[]; resident: PoolRow[]; nodes: PoolRow[]; notes: string[] } {
  const mib = (n: number | 'UNKNOWN') => (n === 'UNKNOWN' ? 'UNKNOWN' : `${n} MiB`)
  return {
    header: `Local Specialist Pool · node ${v.node.id} (${v.node.kind.toLowerCase()}, ${v.state.reachable ? 'runtime reachable' : 'runtime UNREACHABLE'}) · VRAM ${mib(v.state.vramTotalMiB)} · GPU used ${mib(v.state.gpuUsedMiB)} · one generation at a time`,
    roles: v.assignment.members.map((m) => ({ id: m.role, title: `${m.role.replace('_', ' ').toLowerCase()}: ${m.modelRef ?? 'not assigned'}`, detail: `${m.residency.toLowerCase().replace('_', ' ')} · keep-alive ${m.keepAlive} · basis ${m.basis.toLowerCase()} · ${m.reason}` })),
    resident: v.state.residents.length ? v.state.residents.map((r) => ({ id: r.ref, title: r.ref, detail: `size ${r.sizeBytes === 'UNKNOWN' ? 'UNKNOWN' : Math.round(r.sizeBytes / 1048576) + ' MiB'} · on GPU ${r.vramBytes === 'UNKNOWN' ? 'UNKNOWN' : Math.round(r.vramBytes / 1048576) + ' MiB'}` })) : [],
    nodes: v.nodes.map((n) => ({ id: n.id, title: `${n.id} (${n.kind.toLowerCase()})`, detail: n.callable ? 'callable over loopback' : 'recorded for planning, not callable in this version' })),
    notes: v.notes,
  }
}
