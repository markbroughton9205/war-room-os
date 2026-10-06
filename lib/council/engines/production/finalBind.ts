import { attachCouncilEngineFinalPublic, type CouncilEngineFinalPublic } from '../integration/executiveFinal'
import { classifyTrust } from '../final/trust'
import { explainFromReceipts } from '../final/governance'

export function parseEngineFinalCommand(text: string):
  | 'why'
  | 'approve'
  | 'watch'
  | 'portfolio'
  | null {
  const t = text.trim()
  if (/\bwhy did you (do that|stop|ask permission)\b/i.test(t) || /\bwhy this (source|model|tool)\b/i.test(t)) return 'why'
  if (/\b(approve|decline) (this )?(trial|watch|mission|action)\b/i.test(t)) return 'approve'
  if (/\bwatch\b/i.test(t) && /\b(create|approve|disable)\b/i.test(t)) return 'watch'
  if (/\b(priority|portfolio|preempt)\b/i.test(t)) return 'portfolio'
  return null
}

export function bindEngineFinalToLive(input: {
  mission_id: string
  commanderMessage: string
}): { enginesFinal: CouncilEngineFinalPublic } {
  const cmd = parseEngineFinalCommand(input.commanderMessage)
  const trust = classifyTrust({ source: 'commander', text: input.commanderMessage })
  let commander_status: string | undefined
  if (cmd === 'why') {
    commander_status = explainFromReceipts({
      why_stop: 'structured receipts only; no hidden chain-of-thought',
      why_permission: 'consequential action requires canonical ApprovalBroker fingerprint',
    })
  } else if (cmd === 'approve') {
    commander_status = 'ApprovalBroker: text is not approval. Canonical fingerprint required. Auto-promote is false.'
  } else if (cmd === 'watch') {
    commander_status = 'Persistent watches require explicit Commander approval. Detection does not authorize action.'
  } else if (cmd === 'portfolio') {
    commander_status = 'Commander priority is a hard input. WAITING_AUTHORITY does not auto-run.'
  }
  return {
    enginesFinal: attachCouncilEngineFinalPublic({
      trust,
      commander_status,
    }),
  }
}
