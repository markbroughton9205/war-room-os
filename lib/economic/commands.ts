import { getEconomicDomain } from '@/lib/economic/domains'
import { createWorkflowQueueItem } from '@/lib/economic/workflowQueue'
import type {
  EconomicDomainRegistryEntry,
  EconomicOperationalDomainId,
  EconomicWorkflowQueueItem,
  EconomicWorkflowType,
} from '@/lib/economic/types'

export const ECONOMIC_OPERATIONAL_COMMANDS = [
  'scan opportunities',
  'research market gaps',
  'generate income ideas',
  'analyze freight demand',
  'create outreach proposal',
  'investigate automation business',
  'identify underserved industries',
  'build acquisition targets',
] as const

export type EconomicOperationalCommand = (typeof ECONOMIC_OPERATIONAL_COMMANDS)[number]

type CommandRoute = {
  command: EconomicOperationalCommand
  domain_id: EconomicOperationalDomainId
  workflow_type: EconomicWorkflowType
  priority: number
  summaryPrefix: string
}

const COMMAND_ROUTES: readonly CommandRoute[] = [
  {
    command: 'scan opportunities',
    domain_id: 'income_ops',
    workflow_type: 'leads',
    priority: 3,
    summaryPrefix: 'Scan for approval-gated economic opportunities',
  },
  {
    command: 'research market gaps',
    domain_id: 'market_ops',
    workflow_type: 'research_targets',
    priority: 3,
    summaryPrefix: 'Research market gaps for human review',
  },
  {
    command: 'generate income ideas',
    domain_id: 'income_ops',
    workflow_type: 'research_targets',
    priority: 3,
    summaryPrefix: 'Generate income ideas for approval review',
  },
  {
    command: 'analyze freight demand',
    domain_id: 'freight_ops',
    workflow_type: 'research_targets',
    priority: 4,
    summaryPrefix: 'Analyze freight demand without external execution',
  },
  {
    command: 'create outreach proposal',
    domain_id: 'sales_ops',
    workflow_type: 'outreach_drafts',
    priority: 4,
    summaryPrefix: 'Create an outreach proposal draft for approval',
  },
  {
    command: 'investigate automation business',
    domain_id: 'automation_ops',
    workflow_type: 'automation_tasks',
    priority: 3,
    summaryPrefix: 'Investigate automation business options',
  },
  {
    command: 'identify underserved industries',
    domain_id: 'market_ops',
    workflow_type: 'intelligence_reports',
    priority: 3,
    summaryPrefix: 'Identify underserved industries for review',
  },
  {
    command: 'build acquisition targets',
    domain_id: 'acquisition_ops',
    workflow_type: 'acquisition_targets',
    priority: 4,
    summaryPrefix: 'Build acquisition target list for approval',
  },
] as const

export type ParsedEconomicOperationalCommand = {
  matched: true
  command: EconomicOperationalCommand
  domain: EconomicDomainRegistryEntry
  workflow: EconomicWorkflowQueueItem
  recommendedFamilies: EconomicDomainRegistryEntry['providerPriority']
  approvalRequired: true
}

export type EconomicCommandParseResult =
  | ParsedEconomicOperationalCommand
  | { matched: false; reason: 'no_operational_command' }

function normalizeCommand(input: string): string {
  return input.toLowerCase().replace(/\s+/g, ' ').trim()
}

function findCommandRoute(input: string): CommandRoute | null {
  const normalized = normalizeCommand(input)
  return COMMAND_ROUTES.find(route => normalized.includes(route.command)) ?? null
}

export function parseEconomicOperationalCommand(input: string): EconomicCommandParseResult {
  const route = findCommandRoute(input)
  if (!route) {
    return { matched: false, reason: 'no_operational_command' }
  }

  const domain = getEconomicDomain(route.domain_id)
  const workflow = createWorkflowQueueItem({
    domain_id: route.domain_id,
    workflow_type: route.workflow_type,
    assigned_family: domain.providerPriority[0],
    priority: route.priority,
    summary: `${route.summaryPrefix}: ${input.trim().slice(0, 500)}`,
    metadata: {
      command: route.command,
      source: 'economic_operational_command_parser',
      autonomous_execution: false,
      approval_required: true,
    },
  })

  return {
    matched: true,
    command: route.command,
    domain,
    workflow,
    recommendedFamilies: domain.providerPriority,
    approvalRequired: true,
  }
}
