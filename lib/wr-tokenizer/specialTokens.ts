import { EXPECTED_SPECIAL_TOKENS } from './identity'
import type { LoadedWrTokenizer } from './encode'

export type SpecialAuditClass = 'EXISTING' | 'MISSING' | 'NICE_TO_HAVE' | 'UNNECESSARY'

export type SpecialAuditRow = {
  concept: string
  token: string | null
  classification: SpecialAuditClass
  note: string
}

export function auditSpecialTokens(tok: LoadedWrTokenizer): SpecialAuditRow[] {
  const have = new Set(tok.addedTokens.map(t => t.content))
  const rows: SpecialAuditRow[] = EXPECTED_SPECIAL_TOKENS.map(s => ({
    concept: s.token.replace(/<\|/g, '').replace(/\|>/g, ''),
    token: s.token,
    classification: 'EXISTING' as const,
    note: `id ${s.id}`,
  }))
  const extra: SpecialAuditRow[] = [
    {
      concept: 'user',
      token: '<|user|>',
      classification: have.has('<|user|>') ? 'EXISTING' : 'UNNECESSARY',
      note: 'Commander already maps the human turn. Do not add in this pass.',
    },
    {
      concept: 'tool_result',
      token: '<|tool_result|>',
      classification: have.has('<|tool_result|>') ? 'EXISTING' : 'NICE_TO_HAVE',
      note: 'Can serialize inside <|tool|> until a future WR-TOKENIZER-1.',
    },
    {
      concept: 'mission',
      token: '<|mission|>',
      classification: have.has('<|mission|>') ? 'EXISTING' : 'NICE_TO_HAVE',
      note: 'Text marker sufficient for format analysis.',
    },
    {
      concept: 'source',
      token: '<|source|>',
      classification: have.has('<|source|>') ? 'EXISTING' : 'NICE_TO_HAVE',
      note: 'Evidence packet already has <|evidence|>.',
    },
    {
      concept: 'citation',
      token: '<|citation|>',
      classification: have.has('<|citation|>') ? 'EXISTING' : 'NICE_TO_HAVE',
      note: 'Can live inside evidence JSON.',
    },
    {
      concept: 'memory',
      token: '<|memory|>',
      classification: have.has('<|memory|>') ? 'EXISTING' : 'NICE_TO_HAVE',
      note: 'Not required to keep WR-TOKENIZER-0 frozen.',
    },
    {
      concept: 'Council',
      token: '<|council|>',
      classification: have.has('<|council|>') ? 'EXISTING' : 'UNNECESSARY',
      note: 'Natural-language token already fragments acceptably; not a chat role.',
    },
    {
      concept: 'Terra',
      token: '<|terra|>',
      classification: have.has('<|terra|>') ? 'EXISTING' : 'UNNECESSARY',
      note: 'Domain term, not a dialogue role.',
    },
    {
      concept: 'ASTRA',
      token: '<|astra|>',
      classification: have.has('<|astra|>') ? 'EXISTING' : 'UNNECESSARY',
      note: 'Agent name, not a required special.',
    },
    {
      concept: 'agent',
      token: '<|agent|>',
      classification: have.has('<|agent|>') ? 'EXISTING' : 'UNNECESSARY',
      note: 'Covered by system/assistant/tool roles.',
    },
    {
      concept: 'document_boundary',
      token: '<|endoftext|>',
      classification: have.has('<|endoftext|>') ? 'EXISTING' : 'NICE_TO_HAVE',
      note: '<|eos|> already exists as id 2.',
    },
  ]
  return [...rows, ...extra]
}
