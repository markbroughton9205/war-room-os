export function normalizeProofMetadata(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const metadata = input as Record<string, unknown>
  const blockedKeys = ['password', 'routingNumber', 'accountNumber', 'debitCard', 'cardNumber', 'ssn']
  return Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !blockedKeys.some(blocked => key.toLowerCase().includes(blocked.toLowerCase()))),
  )
}

export function proofMetadataHasSensitiveKeys(input: unknown): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const keys = Object.keys(input as Record<string, unknown>).map(key => key.toLowerCase())
  return keys.some(key => ['password', 'routingnumber', 'accountnumber', 'debitcard', 'cardnumber', 'ssn'].some(blocked => key.includes(blocked)))
}
