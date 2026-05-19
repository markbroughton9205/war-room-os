import { listCognitiveBusEvents } from '@/lib/cognitive-bus/bus'
import type { StructuredProviderPacket } from '@/lib/cognitive-bus/types'

export function priorProviderPacketsInThread(threadId: string, beforeFamily?: string): StructuredProviderPacket[] {
  const events = listCognitiveBusEvents(threadId, 120)
  const packets: StructuredProviderPacket[] = []
  for (const event of events) {
    if (event.type !== 'provider_packet') continue
    const packet = event.payload.packet as StructuredProviderPacket | undefined
    if (!packet?.family) continue
    if (beforeFamily && packet.family === beforeFamily) continue
    packets.push(packet)
  }
  return packets
}

export function buildPeerContextBlock(threadId: string, targetFamily: string): string {
  const peers = priorProviderPacketsInThread(threadId, targetFamily)
  if (!peers.length) return ''
  const lines = ['### Prior family structured outputs (traceable; do not fabricate consensus)']
  for (const packet of peers.slice(-4)) {
    lines.push(
      `- ${packet.family} (confidence ${Math.round(packet.confidence * 100)}%): ${packet.observations[0]?.slice(0, 200) ?? 'no observation'}`,
    )
    if (packet.contradictions.length) {
      lines.push(`  contradictions: ${packet.contradictions.slice(0, 2).join(' | ')}`)
    }
  }
  return lines.join('\n')
}
