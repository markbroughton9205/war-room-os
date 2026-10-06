/**
 * Browser Broker Phase 2 — trusted profiles, origin policy, takeover lock, approval.
 * Live Chromium proofs live in browserBroker.phase2.live-acceptance.ts.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { classifyBrowserAction } from './actionClassifier'
import { capabilityFor } from './capabilityTable'
import { detectHumanInteractionRequired } from './humanSignals'
import { evaluateOriginAccess } from './originPolicy'
import {
  createTrustedProfile,
  deleteTrustedProfile,
  loadProfile,
  setProfileState,
  storageStateContainsSecretsInMetadata,
  writeStorageStateFile,
} from './profileStore'
import { auditContainsForbiddenSecrets } from './sessionAudit'
import { councilNeedsTrustedProfile } from './councilClient'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

async function run() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'wr-bb-p2-'))
  process.env.WAR_ROOM_LOCAL_DATA_DIR = tmp
  const results: CaseResult[] = []

  const github = createTrustedProfile({
    display_name: 'GitHub Commander',
    allowed_origins: ['github.com', '*.github.com'],
    allow_foundry: true,
    allow_council: false,
    default_action_policy: 'INTERACTIVE_WITH_APPROVAL',
  })
  results.push(check('PROFILE-1', Boolean(github.profile_id) && github.owner === 'COMMANDER' && github.state === 'ACTIVE', github.profile_id))

  const reloaded = loadProfile(github.profile_id)
  results.push(check('PROFILE-2-meta', Boolean(reloaded && reloaded.display_name === 'GitHub Commander'), reloaded?.display_name ?? 'missing'))

  writeStorageStateFile(github.profile_id, JSON.stringify({ cookies: [{ name: 'sid', value: 'synthetic' }], origins: [] }))
  const again = loadProfile(github.profile_id)
  results.push(check('PROFILE-12', Boolean(again && !storageStateContainsSecretsInMetadata(again)), JSON.stringify(again?.metadata)))

  const originOk = evaluateOriginAccess({ url: 'https://github.com/war-room', allowed_origins: github.allowed_origins, denied_origins: [] })
  const originDeny = evaluateOriginAccess({ url: 'https://evil.example', allowed_origins: github.allowed_origins, denied_origins: [] })
  results.push(check('PROFILE-5', originOk.ok === true && originDeny.ok === false, JSON.stringify({ originOk, originDeny })))

  setProfileState(github.profile_id, 'LOCKED')
  results.push(check('PROFILE-6', loadProfile(github.profile_id)?.state === 'LOCKED', loadProfile(github.profile_id)?.state ?? ''))
  setProfileState(github.profile_id, 'ACTIVE')
  setProfileState(github.profile_id, 'DISABLED')
  results.push(check('PROFILE-7', loadProfile(github.profile_id)?.state === 'DISABLED', loadProfile(github.profile_id)?.state ?? ''))
  setProfileState(github.profile_id, 'ACTIVE')

  results.push(check('PROFILE-8', github.allow_council === false, 'council denied by profile flag'))
  results.push(check('PROFILE-9', github.allow_foundry === true, 'foundry allowed by profile flag'))

  const deleted = deleteTrustedProfile(github.profile_id)
  results.push(check('PROFILE-10', deleted.ok === true && !loadProfile(github.profile_id), JSON.stringify(deleted)))

  const sampleLog = JSON.stringify({ action_type: 'type', result: 'ok' })
  results.push(check('PROFILE-11', !auditContainsForbiddenSecrets(sampleLog) && auditContainsForbiddenSecrets('password=supersecretvalue'), 'redaction helper'))

  results.push(check('TAKEOVER-admin-denied', classifyBrowserAction({ kind: 'control.takeover', owner: 'council' }).verdict === 'DENIED', classifyBrowserAction({ kind: 'control.takeover', owner: 'council' }).reasonCode))
  results.push(check('TAKEOVER-admin-commander', classifyBrowserAction({ kind: 'control.takeover', owner: 'commander' }).verdict === 'ALLOW_RESEARCH', 'commander takeover'))
  results.push(check('APPROVAL-1', classifyBrowserAction({ kind: 'submit', owner: 'foundry' }).verdict === 'ACTION_REQUIRES_APPROVAL', 'submit still gated'))
  results.push(check('APPROVAL-2', classifyBrowserAction({ kind: 'purchase', owner: 'commander' }).verdict === 'ACTION_REQUIRES_APPROVAL', 'trusted profile does not auto-approve'))
  results.push(check('AUTH-3-detect', detectHumanInteractionRequired({ text: 'Enter the MFA code from your authenticator' }) === true, 'mfa'))
  results.push(check('COUNCIL-1-default', councilNeedsTrustedProfile('Research playwright browser contexts') === false, 'public research stays ephemeral'))
  results.push(check('COUNCIL-private', councilNeedsTrustedProfile('Research GitHub issue history in my private repo') === true, 'private needs profile'))
  results.push(check('CAP-create-council', capabilityFor('council', 'profile.create') === 'NO', 'council cannot create'))
  results.push(check('CAP-takeover-foundry', capabilityFor('foundry', 'takeover.start') === 'NO', 'foundry cannot takeover'))
  results.push(check('encryption-ready', createTrustedProfile({ display_name: 'tmp', allow_foundry: true }).encryption.scheme === 'aes-256-gcm' && createTrustedProfile({ display_name: 'tmp2', allow_foundry: true }).encryption.key_backend === 'SECRET_SERVICE', 'secret service encryption, no fake crypto'))

  console.log(results.map(item => `${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`).join('\n'))
  const failed = results.filter(item => !item.pass)
  console.log(`browser broker phase-2 validation: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  rmSync(tmp, { recursive: true, force: true })
  if (failed.length) process.exit(1)
}

run().catch(error => {
  console.error(error)
  process.exit(1)
})
