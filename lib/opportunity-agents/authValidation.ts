import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type OpportunityAuthValidationResult = { id: string; pass: boolean; detail: string }

function test(id: string, fn: () => boolean | string): OpportunityAuthValidationResult {
  try {
    const result = fn()
    return { id, pass: result === true, detail: result === true ? 'PASS' : String(result) }
  } catch (error) {
    return { id, pass: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

function source(path: string): string { return readFileSync(join(process.cwd(), path), 'utf8') }
function handlerHasCommanderFirst(src: string, handler: string): boolean {
  const index = src.indexOf(`export async function ${handler}`)
  if (index < 0) return false
  const body = src.slice(index, index + 360)
  const commander = body.indexOf('requireCommanderSession')
  const json = body.indexOf('req.json')
  const storeRead = Math.min(...['listOpportunityAgentRecords', 'getRecord(', 'runOpportunityWorkflow', 'runSourceRefreshPipeline'].map(token => {
    const i = body.indexOf(token)
    return i < 0 ? Number.POSITIVE_INFINITY : i
  }))
  return commander >= 0 && (json < 0 || commander < json) && (storeRead === Number.POSITIVE_INFINITY || commander < storeRead)
}

export function runOpportunityAuthValidation(): OpportunityAuthValidationResult[] {
  const route = source('app/api/opportunity-agents/route.ts')
  const idRoute = source('app/api/opportunity-agents/[id]/route.ts')
  const sourcesRoute = source('app/api/opportunity-agents/sources/route.ts')
  const refreshRoute = source('app/api/opportunity-agents/sources/refresh/route.ts')
  return [
    test('auth_01_get_opportunity_agents_commander_first', () => handlerHasCommanderFirst(route, 'GET') || 'GET /api/opportunity-agents does not gate first'),
    test('auth_02_post_opportunity_agents_commander_first', () => handlerHasCommanderFirst(route, 'POST') || 'POST /api/opportunity-agents does not gate first'),
    test('auth_03_get_record_commander_first', () => handlerHasCommanderFirst(idRoute, 'GET') || 'GET /api/opportunity-agents/[id] does not gate first'),
    test('auth_04_patch_record_commander_first', () => handlerHasCommanderFirst(idRoute, 'PATCH') || 'PATCH /api/opportunity-agents/[id] does not gate first'),
    test('auth_05_source_status_commander_first', () => handlerHasCommanderFirst(sourcesRoute, 'GET') || 'GET sources route does not gate first'),
    test('auth_06_source_refresh_commander_first', () => handlerHasCommanderFirst(refreshRoute, 'POST') || 'POST source refresh does not gate first'),
    test('auth_07_mutations_reject_without_parallel_auth', () => !route.includes('WAR_ROOM_ACTION_SECRET') && !idRoute.includes('WAR_ROOM_ACTION_SECRET') || 'parallel secret auth introduced'),
    test('auth_08_no_secret_values_returned', () => sourcesRoute.includes('secretsExposed: false') && !sourcesRoute.includes('process.env.') || 'source route may expose env values'),
  ]
}

if (process.argv[1]?.endsWith('authValidation.ts')) {
  const results = runOpportunityAuthValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.id} ${result.detail}`)
  const failed = results.filter(result => !result.pass)
  console.log(`Opportunity Commander auth validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
