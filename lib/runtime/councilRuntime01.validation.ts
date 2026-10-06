/**
 * COUNCIL-RUNTIME-01 persistence, God's Eye, and runtime health truth.
 * Uses the existing local-ownership store and Engine-04 store. No second stack.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { installerActiveStatus } from '@/lib/native-builder/installerTool'
import { createLongHorizonMission, queueAuthorityWait } from '@/lib/council/engines/long-horizon/engine'
import { loadLatestCheckpoint, loadMission, saveMission } from '@/lib/council/engines/long-horizon/store'
import { createCheckpoint } from '@/lib/council/engines/checkpoint/engine'
import { lookupCapability } from '@/lib/council/intelligence/capabilityRegistry'
import { commanderStatusCluster } from '@/lib/council/live-orchestration/rosterHealth'
import { getLocalOwnershipStore, resetLocalOwnershipStoreSingleton } from '@/lib/sovereign-runtime/local-ownership/store'
import { collectPersistenceHealth, persistenceAllowsDurableCouncil } from '@/lib/war-room/persistenceHealth'
import { localCommanderOwnerId, localConversationMessagePost, localConversationsPost } from '@/lib/war-room/localConversationGateway'
import { GODS_EYE_CAPABILITY_ID, godsEyeCardLabel, resolveGodsEyeRuntimeState } from '@/lib/terra/godsEye/runtimeState'
import { aggregateWarRoomRuntimeHealth } from '@/lib/runtime/warRoomRuntimeHealth'

type CaseResult = { name: string; pass: boolean; detail: string }
const results: CaseResult[] = []
function check(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}

function read(rel: string) {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

async function main() {
  const root = mkdtempSync(path.join(tmpdir(), 'council-runtime-01-'))
  const dataDir = path.join(root, 'appdata')
  const engine04 = path.join(root, 'engine-04')
  const previousEngine = process.env.WAR_ROOM_ENGINE04_STORE
  const previousData = process.env.WAR_ROOM_LOCAL_DATA_DIR
  const previousForce = process.env.WAR_ROOM_PERSISTENCE_FORCE
  const previousGods = process.env.WAR_ROOM_GODS_EYE_FORCE
  process.env.WAR_ROOM_ENGINE04_STORE = engine04
  process.env.WAR_ROOM_LOCAL_DATA_DIR = dataDir
  delete process.env.WAR_ROOM_PERSISTENCE_FORCE
  delete process.env.WAR_ROOM_GODS_EYE_FORCE
  resetLocalOwnershipStoreSingleton()

  const active = await installerActiveStatus()
  const execName = active.activeExecutable ? path.basename(path.dirname(path.dirname(path.dirname(active.activeExecutable)))) : ''
  check('RUNTIME01-01', Boolean(active.activeInstallId) && active.valid === true, `${active.activeInstallId ?? 'none'} launcher=${active.launcherPath}`)

  const health = await collectPersistenceHealth({ dataDir, engine04Root: engine04 })
  check('RUNTIME01-02', health.backend === 'local_ownership' && health.readable, health.status)
  check('RUNTIME01-03', health.writable && health.session_persistence && health.mission_persistence, `${health.writable}`)
  check('RUNTIME01-04', health.last_write_at !== null && health.last_readback_at !== null && health.status === 'HEALTHY', health.last_readback_at ?? 'none')

  const store = getLocalOwnershipStore(dataDir)
  const boot = store.bootstrapCommander({ password: 'runtime-01-proof', displayName: 'Commander' })
  if (!boot.ok) throw new Error(boot.reason)
  const session = store.issueSession(boot.identity.id, store.getInstallationId())
  const req = new Request('http://127.0.0.1:3848/api/conversations', {
    method: 'POST',
    headers: { host: '127.0.0.1:3848', cookie: `wr_local_session=${session.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Runtime 01 session', metadata: { council: { source: 'live_council' } } }),
  })
  const owner = await localCommanderOwnerId(req)
  check('RUNTIME01-05', owner === boot.identity.id, owner ?? 'no owner')
  const created = await localConversationsPost(req, boot.identity.id)
  const createdBody = await created.json() as { conversation?: { id?: string } }
  const conversationId = createdBody.conversation?.id ?? ''
  const posted = await localConversationMessagePost(new Request('http://127.0.0.1:3848/api/conversations/x/messages', {
    method: 'POST',
    headers: { host: '127.0.0.1:3848', 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'user', content: 'persist me', family: 'COMMANDER', metadata: { idempotencyKey: 'runtime-01' } }),
  }), boot.identity.id, conversationId)
  const postedBody = await posted.json() as { message?: { content?: string } }
  const reread = store.listCouncilMessages(boot.identity.id, conversationId) ?? []
  check('RUNTIME01-05b', posted.ok && reread.some(row => row.content === 'persist me') && postedBody.message?.content === 'persist me', postedBody.message?.content ?? 'missing')

  resetLocalOwnershipStoreSingleton()
  const reopened = getLocalOwnershipStore(dataDir)
  const afterRestart = reopened.listCouncilMessages(boot.identity.id, conversationId) ?? []
  check('RUNTIME01-06', afterRestart.some(row => row.content === 'persist me'), String(afterRestart.length))

  const mission = await createLongHorizonMission({
    mission_id: 'runtime-01-mission',
    objective: 'Prove engine-04 survival',
    conversation_id: conversationId,
    session_id: 'runtime-01-session',
  })
  const withMemory = {
    ...mission.mission,
    memory_context_refs: ['mem-runtime-01'],
  }
  const waiting = queueAuthorityWait(withMemory, { task_id: 'task-runtime-01', action: 'hold for commander' })
  await saveMission(waiting)
  const checkpoint = await createCheckpoint(waiting, 'authority wait')
  resetLocalOwnershipStoreSingleton()
  const loaded = await loadMission('runtime-01-mission')
  const loadedCheckpoint = await loadLatestCheckpoint('runtime-01-mission')
  check('RUNTIME01-07', loaded?.objective === 'Prove engine-04 survival' && loaded?.ebc_canonical === true && loaded?.grants_authority === false, loaded?.mission_state ?? 'missing')
  check('RUNTIME01-08', loadedCheckpoint?.checkpoint_id === checkpoint.checkpoint.checkpoint_id && loadedCheckpoint?.hidden_cot === false, loadedCheckpoint?.checkpoint_id ?? 'missing')
  check('RUNTIME01-09', loaded?.mission_state === 'WAITING_AUTHORITY' && loaded?.authority_state === 'WAITING_AUTHORITY' && loaded?.pending_approval_refs[0]?.authority === 'COMMANDER', loaded?.authority_state ?? 'none')
  check('RUNTIME01-09b', loaded?.memory_context_refs.includes('mem-runtime-01') === true, loaded?.memory_context_refs.join(',') ?? '')

  check('RUNTIME01-10', persistenceAllowsDurableCouncil(health) && !read('app/page.tsx').includes("setLiveCouncilLoadState('ready')") === false && read('app/page.tsx').includes('Persistence connected. Session and mission state are durable.'), 'durable copy present')
  process.env.WAR_ROOM_PERSISTENCE_FORCE = 'unavailable'
  const failedHealth = await collectPersistenceHealth({ dataDir, engine04Root: engine04 })
  const onlineRoster = { operationalState: 'READY', councilOperational: true, degradedByRoster: false, terraAccess: 'CONNECTED', internetAccess: 'AVAILABLE' } as never
  const degradedPill = commanderStatusCluster(onlineRoster, { systemsOk: true, persistenceStatus: 'UNAVAILABLE' })
  const nominalPill = commanderStatusCluster(onlineRoster, { systemsOk: true, persistenceStatus: 'HEALTHY' })
  check('RUNTIME01-11', failedHealth.status === 'UNAVAILABLE' && persistenceAllowsDurableCouncil(failedHealth) === false && degradedPill.find(row => row.id === 'systems')?.label === 'DEGRADED', degradedPill.find(row => row.id === 'systems')?.label ?? '')
  delete process.env.WAR_ROOM_PERSISTENCE_FORCE

  const gods = resolveGodsEyeRuntimeState({ registered: Boolean(lookupCapability(GODS_EYE_CAPABILITY_ID)) })
  check('RUNTIME01-12', gods.capabilities.some(row => row.id === 'open_stack' && row.responding), gods.capabilities.map(row => row.id).join(','))
  check('RUNTIME01-13', lookupCapability(GODS_EYE_CAPABILITY_ID)?.system === 'Terra' && gods.registered, lookupCapability(GODS_EYE_CAPABILITY_ID)?.capability_id ?? 'missing')
  check('RUNTIME01-14', gods.last_health_check.length > 0 && gods.capability_count >= 6 && gods.failure_reason === null, gods.status)
  check('RUNTIME01-15', gods.terra_linked && gods.runtime_owner === 'terra' && gods.configured, String(gods.terra_linked))
  check('RUNTIME01-16', godsEyeCardLabel(gods) === "GOD'S EYE ACTIVE" && godsEyeCardLabel(resolveGodsEyeRuntimeState({ registered: true, force: 'not_configured' })) === "GOD'S EYE NOT CONFIGURED", godsEyeCardLabel(gods))
  process.env.WAR_ROOM_GODS_EYE_FORCE = 'degraded'
  const degradedGods = resolveGodsEyeRuntimeState({ registered: true })
  check('RUNTIME01-17', degradedGods.status === 'DEGRADED' && degradedGods.healthy === false && godsEyeCardLabel(degradedGods) !== "GOD'S EYE ACTIVE", godsEyeCardLabel(degradedGods))
  delete process.env.WAR_ROOM_GODS_EYE_FORCE

  const nominal = aggregateWarRoomRuntimeHealth({
    persistence: health,
    godsEye: gods,
    coreHealthy: true,
    uiHealthy: true,
    councilOperational: true,
    terraLinked: true,
    browserBrokerReady: true,
  })
  const degraded = aggregateWarRoomRuntimeHealth({
    persistence: failedHealth,
    godsEye: degradedGods,
    coreHealthy: true,
    uiHealthy: true,
    councilOperational: true,
  })
  check('RUNTIME01-18', nominal.status === 'NOMINAL' && nominal.nominal_requires.includes('persistence') && nominal.optional.includes('gods_eye'), nominal.status)
  check('RUNTIME01-19', degraded.status === 'DEGRADED' && nominalPill.find(row => row.id === 'systems')?.label === 'NOMINAL', degraded.status)
  const details = read('components/war-room/runtime/RuntimeTruthDetails.tsx')
  check('RUNTIME01-20', details.includes('data-testid="runtime-persistence-status"') && details.includes('data-testid="runtime-gods-eye-status"') && details.includes('data-testid="runtime-global-status"'), 'details')
  const gateway = read('lib/war-room/localConversationGateway.ts')
  const persistenceSrc = read('lib/war-room/persistenceHealth.ts')
  check('RUNTIME01-21', gateway.includes('existing local-ownership store') && !gateway.includes('new DatabaseSync') && persistenceSrc.includes('engine04StoreRoot') && !read('lib/war-room/localConversationGateway.ts').includes('war_room_conversations_v2'), 'single store')
  check('RUNTIME01-22', read('lib/terra/godsEye/runtimeState.ts').includes('resolveGodsEyeRuntimeState') && !read('components/war-room/terra/TerraHomeGlobePreview.tsx').includes('const godseyeState = GODSEYE_STATE_LABEL'), 'one runtime')
  const ebcSrc = read('lib/council/engines/integration/ebc.ts')
  check('RUNTIME01-23', ebcSrc.includes('ebc_canonical: true') && ebcSrc.includes('export function attachCouncilEnginePublic') && loaded?.ebc_canonical === true, 'ebc canonical')
  check('RUNTIME01-24', loaded?.pending_approval_refs[0]?.authority === 'COMMANDER' && loaded?.grants_authority === false, loaded?.pending_approval_refs[0]?.authority ?? 'none')
  void execName

  if (previousEngine === undefined) delete process.env.WAR_ROOM_ENGINE04_STORE
  else process.env.WAR_ROOM_ENGINE04_STORE = previousEngine
  if (previousData === undefined) delete process.env.WAR_ROOM_LOCAL_DATA_DIR
  else process.env.WAR_ROOM_LOCAL_DATA_DIR = previousData
  if (previousForce === undefined) delete process.env.WAR_ROOM_PERSISTENCE_FORCE
  else process.env.WAR_ROOM_PERSISTENCE_FORCE = previousForce
  if (previousGods === undefined) delete process.env.WAR_ROOM_GODS_EYE_FORCE
  else process.env.WAR_ROOM_GODS_EYE_FORCE = previousGods
  resetLocalOwnershipStoreSingleton()

  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(result => !result.pass)
  console.log(`COUNCIL_RUNTIME_01 ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error)
    process.exit(1)
  })
}
