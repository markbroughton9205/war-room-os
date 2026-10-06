import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { AssemblyPlanV1, EbcAgentId, EbcMissionClass, EbcTask } from './types'
import { selectAgentsForMission } from '@/lib/council/gi/agentSelectionPolicy'

export const EBC_SEAT_BY_AGENT: Record<EbcAgentId, CouncilOrchestrationFamily> = {
  AURORA: 'chatgpt',
  ORION: 'claude',
  PULSAR: 'grok',
  LUMEN: 'gemini',
  NOVA: 'nova',
  PHOENIX: 'red_team',
}

export const EBC_AGENT_BY_SEAT: Partial<Record<CouncilOrchestrationFamily, EbcAgentId>> = {
  chatgpt: 'AURORA',
  claude: 'ORION',
  grok: 'PULSAR',
  gemini: 'LUMEN',
  nova: 'NOVA',
  red_team: 'PHOENIX',
}

export const AGENT_CONTRACTS: Record<EbcAgentId, {
  role: string
  job: string
  fail: string[]
  output: string
}> = {
  ORION: {
    role: 'Investigator / systems analyst',
    job: 'Decompose the problem, name a causal hypothesis, pick a probe that can falsify it. Symptom ≠ root cause.',
    fail: ['poetic narration', 'READY without probe', 'invented citations', 'summarizing other agents', 'I agree'],
    output: 'claims + evidence + falsifiers',
  },
  LUMEN: {
    role: 'Verifier',
    job: 'Check each material claim against evidence IDs, source quality, freshness, and independent corroboration. Wording similarity is not verification.',
    fail: ['sycophantic agree-with-author', 'style judging', 'duplicate source counted as independent'],
    output: 'SUPPORTED | UNSUPPORTED | CONTRADICTED | UNKNOWN',
  },
  PULSAR: {
    role: 'Live / current intelligence',
    job: 'Fresh external information with dated primary sources. Separate current facts from older background. Never uncited current claims.',
    fail: ['undated recently', 'invented URL', 'one-source current fact', 'duplicating ORION'],
    output: 'claims + live evidence',
  },
  NOVA: {
    role: 'Structure / schema / data analysis',
    job: 'Normalize, tabulate, schema-validate, compute with tools. No hallucinated arithmetic.',
    fail: ['invent cells', 'prose-only dump', 'mental math for numeric claims'],
    output: 'typed structure',
  },
  PHOENIX: {
    role: 'Adversarial validator',
    job: 'Challenge only top-risk thin claims. Each challenge names type, weakness, why it matters, test, and resolution.',
    fail: ['rhetorical skepticism', 'rephrase-as-close', 'challenge everything'],
    output: 'CONFLICT | RISK | MISSING PROBE | FALSIFYING TEST',
  },
  AURORA: {
    role: 'Evidence-constrained synthesizer',
    job: 'Answer the Commander first from the surviving board. Unified brief. No seat-by-seat recap unless asked.',
    fail: ['new facts', 'upgrade UNKNOWN', 'false consensus', 'poetic filler', 'read worker chat as fact', 'ORION says'],
    output: 'typed completion_state + provenance-preserving facts',
  },
}

function task(
  mission_id: string,
  owner: EbcAgentId,
  objective: string,
  tools: string[],
  acceptance: string,
  critical: boolean,
  index: number,
): EbcTask {
  return Object.freeze({
    task_id: `t${index}`,
    mission_id,
    owner,
    objective,
    tools,
    acceptance,
    depends_on: [],
    parallel_group: 'R1',
    critical,
  })
}

export function decomposeTasks(plan: AssemblyPlanV1, commanderMessage: string): EbcTask[] {
  const mission_id = plan.mission_id
  const text = commanderMessage
  const tasks: EbcTask[] = []
  let i = 1

  if (plan.mission_class === 'SOCIAL_CHECKIN') {
    tasks.push(task(mission_id, 'AURORA', 'Acknowledge presence in one or two sentences. No research.', [], 'presence acknowledgment; no evidence required', false, i++))
    return tasks
  }

  if (plan.mission_class === 'SYSTEM_STATUS' || plan.mission_class === 'INCIDENT_RESPONSE') {
    if (plan.selected_agents.includes('ORION')) {
      if (plan.required_tools.includes('wr.core.health')) {
        tasks.push(task(mission_id, 'ORION', 'Probe Core health endpoint', ['wr.core.health'], 'evidence row with status_code + retrieved_at', true, i++))
      }
      if (plan.required_tools.includes('wr.ui.health')) {
        tasks.push(task(mission_id, 'ORION', 'Probe UI health endpoint', ['wr.ui.health'], 'evidence row with status_code + retrieved_at', true, i++))
      }
      if (plan.required_tools.includes('wr.ports.list')) {
        tasks.push(task(mission_id, 'ORION', 'List critical runtime ports/processes', ['wr.ports.list'], 'typed listeners for 3847/3848', true, i++))
      }
      if (plan.required_tools.includes('wr.council.backend')) {
        tasks.push(task(mission_id, 'ORION', 'Probe Council local backend health', ['wr.council.backend'], 'evidence row with backend reachability', true, i++))
      }
    }
    if (plan.selected_agents.includes('NOVA') && plan.required_tools.includes('wr.ports.list')) {
      tasks.push(task(mission_id, 'NOVA', 'Normalize port dump into typed structure', ['wr.ports.list'], 'typed table, not prose-only', true, i++))
    }
    if (plan.selected_agents.includes('PULSAR')) {
      const tools = plan.required_tools.includes('wr.broker.status') ? ['wr.broker.status'] : ['wr.broker.status']
      tasks.push(task(mission_id, 'PULSAR', 'Probe CURRENT_LIVE Browser Broker status', tools, 'broker.status snapshot or TOOL_BLOCKED', true, i++))
    }
    return tasks
  }

  if (plan.mission_class === 'CURRENT_INTEL' || plan.mission_class === 'DEEP_RESEARCH') {
    if (plan.selected_agents.includes('PULSAR')) {
      tasks.push(task(mission_id, 'PULSAR', `Retrieve dated live sources for: ${text.slice(0, 160)}`, ['broker.fetch'], 'evidence rows with url + retrieved_at or TOOL_BLOCKED', true, i++))
    }
    if (plan.selected_agents.includes('ORION')) {
      tasks.push(task(mission_id, 'ORION', `Investigate official/primary documentation slice: ${text.slice(0, 120)}`, ['broker.fetch'], 'claims with evidence_ids; primary sources preferred', true, i++))
    }
    return tasks
  }

  if (plan.mission_class === 'ENGINEERING' || plan.mission_class === 'ARCHITECTURE_REVIEW') {
    if (plan.selected_agents.includes('ORION')) {
      tasks.push(task(mission_id, 'ORION', 'Analyze current repo/runtime state without executing Foundry mutations', ['wr.git.branch'], 'analysis claims with repo evidence; no mutation', true, i++))
    }
    if (plan.selected_agents.includes('NOVA')) {
      tasks.push(task(mission_id, 'NOVA', 'Structure options, constraints, and interfaces', [], 'typed options; no Foundry execute', true, i++))
    }
    return tasks
  }

  if (plan.mission_class === 'DOCUMENT_ANALYSIS') {
    if (plan.selected_agents.includes('NOVA')) {
      tasks.push(task(mission_id, 'NOVA', 'Normalize and schema-validate the supplied document/data', [], 'typed structure, not essay', true, i++))
    }
    return tasks
  }

  tasks.push(task(mission_id, plan.selected_agents[0] ?? 'ORION', `Investigate: ${text.slice(0, 160)}`, plan.required_tools, 'at least one evidence-producing claim', true, i++))
  return tasks
}

export function round1WorkerAgents(plan: AssemblyPlanV1, tasks: readonly EbcTask[]): EbcAgentId[] {
  const owners = tasks.map(task => task.owner).filter(owner => owner !== 'LUMEN' && owner !== 'PHOENIX' && owner !== 'AURORA')
  if (plan.mission_class === 'SOCIAL_CHECKIN') return plan.selected_agents.slice(0, 1)
  return [...new Set(owners.length ? owners : plan.selected_agents.filter(id => id === 'ORION' || id === 'PULSAR' || id === 'NOVA'))]
}

export function missionRequiresLiveEvidence(missionClass: EbcMissionClass): boolean {
  return missionClass === 'SYSTEM_STATUS' || missionClass === 'INCIDENT_RESPONSE' || missionClass === 'CURRENT_INTEL' || missionClass === 'DEEP_RESEARCH'
}
