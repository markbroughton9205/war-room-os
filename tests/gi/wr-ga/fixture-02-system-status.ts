import { classifyCouncilPath } from '@/lib/council/gi/pathClassifier'
import { routeAgentPath, agentPathUsesExistingEbc } from '@/lib/council/gi/agentPath'

export const WR_GA_02_GOLD = {
  prompt: 'Status on War Room',
  path: 'AGENT_PATH',
  mission_class: 'SYSTEM_STATUS',
}

export function runWrGa02() {
  const classified = classifyCouncilPath(WR_GA_02_GOLD.prompt)
  const route = routeAgentPath(WR_GA_02_GOLD.prompt, classified)
  return {
    classified,
    route,
    pass:
      classified.path === 'AGENT_PATH'
      && classified.mission_class === 'SYSTEM_STATUS'
      && agentPathUsesExistingEbc(route)
      && route.seats_default_six === false,
  }
}
