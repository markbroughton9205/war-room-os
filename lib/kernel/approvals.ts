import type { ApprovalRisk } from './types'

type ApprovalGate = {
  label: string
  rule: string
  canSuggest: boolean
  requiresRaelApproval: boolean
  secureApprovalRequired: boolean
}

export const APPROVAL_RISK_GATES: Record<ApprovalRisk, ApprovalGate> = {
  low: {
    label: 'Low',
    rule: 'Can suggest and prepare context without taking external action.',
    canSuggest: true,
    requiresRaelApproval: false,
    secureApprovalRequired: false,
  },
  medium: {
    label: 'Medium',
    rule: "Ask Ra'el before committing memory, notifications, or workflow changes.",
    canSuggest: true,
    requiresRaelApproval: true,
    secureApprovalRequired: false,
  },
  high: {
    label: 'High',
    rule: "Require explicit Ra'el approval before any consequential action.",
    canSuggest: true,
    requiresRaelApproval: true,
    secureApprovalRequired: false,
  },
  financial: {
    label: 'Financial',
    rule: 'Payment, payout, invoice, and banking-adjacent actions require secure War Room approval.',
    canSuggest: true,
    requiresRaelApproval: true,
    secureApprovalRequired: true,
  },
  legal: {
    label: 'Legal',
    rule: 'Contract, legal, compliance, and rights-impacting actions require secure War Room approval.',
    canSuggest: true,
    requiresRaelApproval: true,
    secureApprovalRequired: true,
  },
  identity: {
    label: 'Identity',
    rule: 'Identity, account, credential, and verification actions require secure War Room approval.',
    canSuggest: true,
    requiresRaelApproval: true,
    secureApprovalRequired: true,
  },
  deployment: {
    label: 'Deployment',
    rule: 'Build, deploy, repo-write, and production-impacting actions require secure War Room approval.',
    canSuggest: true,
    requiresRaelApproval: true,
    secureApprovalRequired: true,
  },
}

export const SECURE_APPROVAL_RISKS: ApprovalRisk[] = ['financial', 'legal', 'identity', 'deployment']
