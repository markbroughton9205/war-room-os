export type PaymentProviderId = 'stripe' | 'paypal' | 'square' | 'ach_placeholder' | 'manual_proof'

export type DepositStatus =
  | 'expected'
  | 'pending_proof'
  | 'proof_submitted'
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'notified'
  | 'disputed'
  | 'failed'
  | 'rejected'

export type NotificationStatus = 'not_sent' | 'queued' | 'sent' | 'failed'

export type ProofStatus = 'not_required' | 'required' | 'submitted' | 'verified' | 'rejected'

export type RiskStatus = 'clear' | 'review' | 'blocked'

export type DepositRecord = {
  depositId: string
  opportunityId: string | null
  incomeWorkerId: string | null
  platformProvider: PaymentProviderId | string
  payerPlatformName: string
  expectedAmount: number | null
  confirmedAmount: number | null
  currency: string
  expectedDate: string | null
  confirmedDate: string | null
  proofRequired: boolean
  proofStatus: ProofStatus
  proofUrl: string | null
  proofMetadata: Record<string, unknown> | null
  depositStatus: DepositStatus
  notificationStatus: NotificationStatus
  riskStatus: RiskStatus
  createdAt: string
  updatedAt: string
}

export type PaymentProviderReadiness = {
  id: PaymentProviderId
  name: string
  status: 'configured' | 'not_configured' | 'placeholder'
  notes: string
}

export type PaymentGuardFinding = {
  id: string
  severity: 'info' | 'warn' | 'error' | 'critical'
  kind: string
  message: string
  blocksConfirmation: boolean
  depositId?: string
}
