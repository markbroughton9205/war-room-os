import { WORKSPACE_PROPOSAL_CATEGORIES, type WorkspaceProposalInput } from './types'

export type ProposalInputValidation =
  | { ok: true; value: WorkspaceProposalInput }
  | { ok: false; reason: string }

export function validateProposalInput(input: unknown, partial = false): ProposalInputValidation {
  const record = asRecord(input)
  if (!record) return { ok: false, reason: 'body_must_be_object' }

  const title = typeof record.title === 'string' ? cleanText(record.title, 160) : partial ? undefined : null
  const description = typeof record.description === 'string' ? cleanText(record.description, 5000) : partial ? undefined : null
  const category = typeof record.category === 'string' ? record.category : partial ? undefined : null

  if (title === null || title === '') return { ok: false, reason: 'title_required' }
  if (description === null || description === '') return { ok: false, reason: 'description_required' }
  if (category === null || (category !== undefined && !WORKSPACE_PROPOSAL_CATEGORIES.includes(category as never))) {
    return { ok: false, reason: 'category_invalid' }
  }

  return {
    ok: true,
    value: {
      title: title ?? '',
      description: description ?? '',
      category: category as WorkspaceProposalInput['category'],
    },
  }
}

export function asRecord(input: unknown): Record<string, unknown> | null {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : null
}

function cleanText(value: string, maxLength: number): string | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxLength) return null
  return trimmed
}
