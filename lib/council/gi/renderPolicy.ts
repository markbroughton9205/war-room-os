import type { CouncilPath } from './types'

export function fullTeamRequiredForGiPath(path: CouncilPath): boolean {
  return path === 'AGENT_PATH'
}

export function shouldRenderFullCouncilPanel(path: CouncilPath): boolean {
  return path === 'AGENT_PATH'
}
