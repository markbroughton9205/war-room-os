// Live-DB validation for Wave 2's project-scoped search fix (closeout mission). Requires a real
// Supabase-compatible backend (local Postgres+PostgREST or a real project) reachable via
// NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — matches this repo's existing `:live`
// suffix convention (see validate:income-loot:live, validate:research-engine:live) since the
// project-scoping contract is inherently a DB-query concern that a pure in-memory fake can't
// exercise honestly. Not run by default; invoke via `pnpm run validate:search:live` against a
// local instance. Seeds and tears down its own fixtures — safe to run repeatedly.
import { pathToFileURL } from 'node:url'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { searchAcrossCategories } from './query'

type CaseResult = { name: string; pass: boolean; detail: string }
const results: CaseResult[] = []
function check(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}

const SHARED_TERM = 'zephyrquartz'

async function main() {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    console.log('FAIL supabase_client_construction', sup.configError)
    process.exit(1)
  }

  const { data: projectA } = await sup.client.from('war_room_projects').insert({ name: 'Project A (scoping test)' }).select('id').single()
  const { data: projectB } = await sup.client.from('war_room_projects').insert({ name: 'Project B (scoping test)' }).select('id').single()
  const projectAId = projectA!.id as string
  const projectBId = projectB!.id as string

  const { data: convA } = await sup.client.from('war_room_conversations').insert({ title: 'Conv A', active_project_id: projectAId }).select('id').single()
  const conversationAId = convA!.id as string

  // --- Fixtures: identical shared term across both projects so a leaking filter would be obvious ---
  const { data: memA } = await sup.client
    .from('war_room_memory_records')
    .insert({ content: `${SHARED_TERM} decision for project A`, memory_type: 'project_fact', scope: 'project', project_id: projectAId, status: 'active' })
    .select('id').single()
  await sup.client
    .from('war_room_memory_records')
    .insert({ content: `${SHARED_TERM} decision for project B`, memory_type: 'project_fact', scope: 'project', project_id: projectBId, status: 'active' })

  const { data: promptA } = await sup.client
    .from('war_room_prompt_artifacts')
    .insert({ project_id: projectAId, intent: 'GENERIC_AGENT_MISSION_PROMPT', target_agent_id: 'test', prompt_text: `${SHARED_TERM} prompt for project A`, status: 'delivered' })
    .select('id').single()
  await sup.client
    .from('war_room_prompt_artifacts')
    .insert({ project_id: projectBId, intent: 'GENERIC_AGENT_MISSION_PROMPT', target_agent_id: 'test', prompt_text: `${SHARED_TERM} prompt for project B`, status: 'delivered' })

  const { data: loopA } = await sup.client
    .from('war_room_open_loops')
    .insert({ project_id: projectAId, title: `${SHARED_TERM} open loop for project A`, status: 'open' })
    .select('id').single()
  await sup.client
    .from('war_room_open_loops')
    .insert({ project_id: projectBId, title: `${SHARED_TERM} open loop for project B`, status: 'open' })
  const { data: droppedLoopA } = await sup.client
    .from('war_room_open_loops')
    .insert({ project_id: projectAId, title: `${SHARED_TERM} dropped loop for project A`, status: 'dropped' })
    .select('id').single()

  const { data: wkA } = await sup.client
    .from('war_room_world_knowledge_records')
    .insert({ content: `${SHARED_TERM} fact scoped to project A`, project_id: projectAId, scope: 'project', status: 'active' })
    .select('id').single()
  await sup.client
    .from('war_room_world_knowledge_records')
    .insert({ content: `${SHARED_TERM} fact scoped to project B`, project_id: projectBId, scope: 'project', status: 'active' })

  const { data: claimA } = await sup.client
    .from('war_room_claim_records')
    .insert({ normalized_claim_text: `${SHARED_TERM} claim for project A`, project_id: projectAId, status: 'candidate' })
    .select('id').single()
  await sup.client
    .from('war_room_claim_records')
    .insert({ normalized_claim_text: `${SHARED_TERM} claim for project B`, project_id: projectBId, status: 'candidate' })

  const { data: sourceA } = await sup.client
    .from('war_room_source_records')
    .insert({ title: `${SHARED_TERM} source used only by project A` })
    .select('id').single()
  await sup.client.from('war_room_learning_sessions').insert({ project_id: projectAId, objective: 'scoping test', status: 'completed', source_ids: [sourceA!.id] })

  await sup.client.from('war_room_messages').insert({ conversation_id: conversationAId, role: 'user', content: `${SHARED_TERM} message in project A's conversation` })

  // --- Superseded memory in Project A — must stay excluded even when correctly scoped ---
  await sup.client
    .from('war_room_memory_records')
    .insert({ content: `${SHARED_TERM} superseded decision for project A`, memory_type: 'project_fact', scope: 'project', project_id: projectAId, status: 'superseded' })

  // --- Ranking-survives-project-filtering fixture: two Project A memories both matching the
  // query; the lower-importance one is inserted AFTER the higher-importance one, so ranking-by-
  // insertion-order would put them in the wrong order — only real importance-weighted ranking
  // gets this right. (A true exact-vs-partial FTS comparison isn't meaningful here: websearch
  // AND-semantics mean a document missing a query term doesn't "partially match", it doesn't
  // match at all — that distinction is already covered by lib/search/rank.validation.ts's pure
  // synthetic-textMatchStrength tests, which don't depend on Postgres tokenization quirks.)
  const { data: lowImportanceA } = await sup.client
    .from('war_room_memory_records')
    .insert({ content: `${SHARED_TERM} low-importance note for project A`, memory_type: 'project_fact', scope: 'project', project_id: projectAId, status: 'active', importance_tier: 'trivial' })
    .select('id').single()
  await sup.client.from('war_room_memory_records').update({ importance_tier: 'critical' }).eq('id', memA!.id)

  // A. Memory
  const scopedA = await searchAcrossCategories({ query: SHARED_TERM, categories: ['memory'], scope: { projectId: projectAId } })
  check('A_project_a_memory_excludes_project_b', scopedA.memory.every(r => r.id !== undefined) && !scopedA.memory.some(r => r.snippet.includes('project B')), JSON.stringify(scopedA.memory.map(r => r.snippet)))
  check('A_project_a_memory_includes_project_a', scopedA.memory.some(r => r.id === memA!.id), JSON.stringify(scopedA.memory.map(r => r.id)))

  // B. Prompt artifact
  const scopedB = await searchAcrossCategories({ query: SHARED_TERM, categories: ['prompt_artifact'], scope: { projectId: projectAId } })
  check('B_project_a_prompt_excludes_project_b', !scopedB.prompt_artifact.some(r => r.snippet.includes('project B')), JSON.stringify(scopedB.prompt_artifact.map(r => r.snippet)))
  check('B_project_a_prompt_includes_project_a', scopedB.prompt_artifact.some(r => r.id === promptA!.id), JSON.stringify(scopedB.prompt_artifact.map(r => r.id)))

  // C. Open loop
  const scopedC = await searchAcrossCategories({ query: SHARED_TERM, categories: ['open_loop'], scope: { projectId: projectAId } })
  check('C_project_a_open_loop_excludes_project_b', !scopedC.open_loop.some(r => r.title.includes('project B')), JSON.stringify(scopedC.open_loop.map(r => r.title)))
  check('C_project_a_open_loop_includes_project_a', scopedC.open_loop.some(r => r.id === loopA!.id), JSON.stringify(scopedC.open_loop.map(r => r.id)))

  // D. World knowledge
  const scopedD = await searchAcrossCategories({ query: SHARED_TERM, categories: ['world_knowledge'], scope: { projectId: projectAId } })
  check('D_project_a_world_knowledge_excludes_project_b', !scopedD.world_knowledge.some(r => r.snippet.includes('project B')), JSON.stringify(scopedD.world_knowledge.map(r => r.snippet)))
  check('D_project_a_world_knowledge_includes_project_a', scopedD.world_knowledge.some(r => r.id === wkA!.id), JSON.stringify(scopedD.world_knowledge.map(r => r.id)))

  // E. Claim (direct relational path)
  const scopedE = await searchAcrossCategories({ query: SHARED_TERM, categories: ['claim'], scope: { projectId: projectAId } })
  check('E_project_a_claim_excludes_project_b', !scopedE.claim.some(r => r.snippet.includes('project B')), JSON.stringify(scopedE.claim.map(r => r.snippet)))
  check('E_project_a_claim_includes_project_a', scopedE.claim.some(r => r.id === claimA!.id), JSON.stringify(scopedE.claim.map(r => r.id)))

  // F. Source (indirect relational path via learning session)
  const scopedFA = await searchAcrossCategories({ query: SHARED_TERM, categories: ['source'], scope: { projectId: projectAId } })
  const scopedFB = await searchAcrossCategories({ query: SHARED_TERM, categories: ['source'], scope: { projectId: projectBId } })
  check('F_source_reachable_via_learning_session_for_project_a', scopedFA.source.some(r => r.id === sourceA!.id), JSON.stringify(scopedFA.source.map(r => r.id)))
  check('F_source_not_reachable_for_unrelated_project_b', !scopedFB.source.some(r => r.id === sourceA!.id), JSON.stringify(scopedFB.source.map(r => r.id)))

  // G. Conversation (indirect relational path via conversations.active_project_id)
  const scopedGA = await searchAcrossCategories({ query: SHARED_TERM, categories: ['conversation'], scope: { projectId: projectAId } })
  const scopedGB = await searchAcrossCategories({ query: SHARED_TERM, categories: ['conversation'], scope: { projectId: projectBId } })
  check('G_conversation_search_includes_project_a_message', scopedGA.conversation.length > 0, String(scopedGA.conversation.length))
  check('G_conversation_search_excludes_for_unrelated_project_b', scopedGB.conversation.length === 0, String(scopedGB.conversation.length))

  // H. Global/no-project search still returns cross-project results
  const globalSearch = await searchAcrossCategories({ query: SHARED_TERM, categories: ['memory'] })
  const memoryTexts = globalSearch.memory.map(r => r.snippet)
  check(
    'H_global_search_returns_both_projects',
    memoryTexts.some(t => t.includes('project A')) && memoryTexts.some(t => t.includes('project B')),
    JSON.stringify(memoryTexts),
  )

  // I. Superseded/inactive excluded even within correct project scope
  check('I_superseded_memory_excluded_within_project_scope', !scopedA.memory.some(r => r.snippet.includes('superseded')), JSON.stringify(scopedA.memory.map(r => r.snippet)))
  const scopedDroppedLoop = await searchAcrossCategories({ query: SHARED_TERM, categories: ['open_loop'], scope: { projectId: projectAId } })
  check('I_dropped_open_loop_excluded_within_project_scope', !scopedDroppedLoop.open_loop.some(r => r.id === droppedLoopA!.id), JSON.stringify(scopedDroppedLoop.open_loop.map(r => r.id)))

  // J. Importance-weighted relevance ranking survives project filtering — proves the DB-level
  // project_id filter doesn't disturb the application-level ranking that runs on the results.
  const rankingCheck = await searchAcrossCategories({ query: SHARED_TERM, categories: ['memory'], scope: { projectId: projectAId } })
  const criticalMatch = rankingCheck.memory.find(r => r.id === memA!.id)
  const trivialMatch = rankingCheck.memory.find(r => r.id === lowImportanceA!.id)
  check(
    'J_critical_importance_outranks_trivial_after_project_filtering',
    !!criticalMatch && !!trivialMatch && criticalMatch.score > trivialMatch.score,
    `critical=${criticalMatch?.score} trivial=${trivialMatch?.score}`,
  )

  // --- Report ---
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`\nProject-scoped search live validation: ${results.length - failed.length}/${results.length} PASS`)

  // --- Cleanup (deletes everything this run created, including rows left orphaned by
  // project/conversation deletion's on-delete-set-null FKs, so repeated runs stay tidy) ---
  await sup.client.from('war_room_learning_sessions').delete().eq('project_id', projectAId)
  await sup.client.from('war_room_claim_records').delete().ilike('normalized_claim_text', `${SHARED_TERM}%`)
  await sup.client.from('war_room_world_knowledge_records').delete().ilike('content', `${SHARED_TERM}%`)
  await sup.client.from('war_room_open_loops').delete().ilike('title', `${SHARED_TERM}%`)
  await sup.client.from('war_room_prompt_artifacts').delete().ilike('prompt_text', `${SHARED_TERM}%`)
  await sup.client.from('war_room_memory_records').delete().ilike('content', `${SHARED_TERM}%`)
  await sup.client.from('war_room_memory_records').delete().ilike('content', 'unrelated partial mention of zephyr only')
  await sup.client.from('war_room_source_records').delete().eq('id', sourceA!.id)
  await sup.client.from('war_room_conversations').delete().in('id', [conversationAId])
  await sup.client.from('war_room_projects').delete().in('id', [projectAId, projectBId])

  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
