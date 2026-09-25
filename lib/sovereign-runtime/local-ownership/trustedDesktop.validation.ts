/**
 * Trusted local desktop auto-entry — structural + isolated-store proof.
 * Does not require a live UI. Live HTTP/LAN proofs are scripts/foundry-trusted-desktop-live-proof.ts.
 */
import { pathToFileURL } from 'node:url'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import {
  AUTH_MODE,
  DESKTOP_TRUST_ENV,
  DESKTOP_TRUST_FILE,
  DESKTOP_TRUST_HEADER,
  DESKTOP_TRUST_MIN_LENGTH,
  TRUSTED_DESKTOP_MINT_PATH,
} from './desktopTrustShared'
import {
  loadOrCreateDesktopTrustSecret,
  verifyDesktopTrustProof,
} from './desktopTrust'
import { hasPresentedTrustedDesktopProof, hasPresentedLocalCommanderSession } from './edgeSession'
import { getLocalOwnershipStore, resetLocalOwnershipStoreSingleton } from './store'
import { isLoopbackRequestHost } from '@/lib/sovereign-runtime/loopback'
import { assertLocalOnlyRequest } from './gate'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const repoRoot = resolve('.')
  const tmp = mkdtempSync(join(tmpdir(), 'wr-trusted-desktop-'))
  const prevDataDir = process.env.WAR_ROOM_LOCAL_DATA_DIR
  const prevSecret = process.env[DESKTOP_TRUST_ENV]
  delete process.env[DESKTOP_TRUST_ENV]
  process.env.WAR_ROOM_LOCAL_DATA_DIR = tmp
  resetLocalOwnershipStoreSingleton()

  try {
    const middlewareSrc = readFileSync(resolve(repoRoot, 'lib/supabase/middleware.ts'), 'utf8')
    const loginSrc = readFileSync(resolve(repoRoot, 'app/login/page.tsx'), 'utf8')
    const mainSrc = readFileSync(resolve(repoRoot, 'desktop/src/main.cjs'), 'utf8')
    const cjsSrc = readFileSync(resolve(repoRoot, 'desktop/src/desktopTrust.cjs'), 'utf8')
    const storeSrc = readFileSync(resolve(repoRoot, 'lib/sovereign-runtime/local-ownership/store.ts'), 'utf8')
    const panelSrc = readFileSync(resolve(repoRoot, 'components/auth/LocalCommanderLoginPanel.tsx'), 'utf8')
    const mintSrc = readFileSync(resolve(repoRoot, 'app/api/sovereign/local-auth/trusted-desktop/route.ts'), 'utf8')

    results.push(check(
      'constants_header_and_env_stable',
      DESKTOP_TRUST_HEADER === 'x-war-room-desktop-trust'
        && DESKTOP_TRUST_ENV === 'WAR_ROOM_DESKTOP_TRUST_SECRET'
        && DESKTOP_TRUST_FILE === 'desktop-trust.secret'
        && TRUSTED_DESKTOP_MINT_PATH === '/api/sovereign/local-auth/trusted-desktop',
      `${DESKTOP_TRUST_HEADER} ${DESKTOP_TRUST_ENV}`,
    ))

    results.push(check(
      'electron_cjs_matches_shared_constants',
      cjsSrc.includes(`'${DESKTOP_TRUST_HEADER}'`)
        && cjsSrc.includes(`'${DESKTOP_TRUST_ENV}'`)
        && cjsSrc.includes(`'${DESKTOP_TRUST_FILE}'`)
        && cjsSrc.includes(TRUSTED_DESKTOP_MINT_PATH),
      'desktop/src/desktopTrust.cjs stays aligned with Next constants',
    ))

    results.push(check(
      'auth_modes_explicit',
      AUTH_MODE.LOCAL_COMMANDER_TRUSTED === 'LOCAL_COMMANDER_TRUSTED'
        && AUTH_MODE.REMOTE_AUTHENTICATED === 'REMOTE_AUTHENTICATED'
        && AUTH_MODE.UNAUTHENTICATED === 'UNAUTHENTICATED',
      Object.values(AUTH_MODE).join(','),
    ))

    results.push(check(
      'loopback_alone_is_not_trusted_desktop',
      isLoopbackRequestHost('127.0.0.1:3848')
        && !hasPresentedTrustedDesktopProof({ host: '127.0.0.1:3848', trustHeader: null })
        && !hasPresentedTrustedDesktopProof({ host: '127.0.0.1:3848', trustHeader: 'short' }),
      'Host header is insufficient without a well-formed desktop proof',
    ))

    const fakeProof = 'a'.repeat(DESKTOP_TRUST_MIN_LENGTH)
    results.push(check(
      'lan_host_never_counts_as_trusted_desktop',
      !hasPresentedTrustedDesktopProof({ host: '192.168.1.50:3848', trustHeader: fakeProof })
        && !hasPresentedTrustedDesktopProof({ host: '10.0.0.8:3848', trustHeader: fakeProof })
        && !isLoopbackRequestHost('192.168.1.50:3848')
        && assertLocalOnlyRequest({ host: '192.168.1.50:3848' }).ok === false,
      'LAN origin cannot present trusted-desktop auto-entry',
    ))

    results.push(check(
      'public_host_denied_for_local_auth',
      assertLocalOnlyRequest({ host: 'warroomos.com' }).ok === false,
      'remote account path stays separate',
    ))

    const secret = loadOrCreateDesktopTrustSecret(tmp)
    results.push(check(
      'secret_is_high_entropy_not_plaintext_password',
      secret.length >= DESKTOP_TRUST_MIN_LENGTH && !/password/i.test(secret),
      `len=${secret.length}`,
    ))

    results.push(check(
      'matching_secret_verifies',
      verifyDesktopTrustProof({ presentedHeader: secret, dataDirOverride: tmp }).ok === true,
      'ok',
    ))

    results.push(check(
      'wrong_secret_denied',
      verifyDesktopTrustProof({ presentedHeader: fakeProof, dataDirOverride: tmp }).ok === false,
      'mismatch is fail-closed',
    ))

    results.push(check(
      'missing_header_denied',
      verifyDesktopTrustProof({ presentedHeader: null, dataDirOverride: tmp }).ok === false,
      'ok',
    ))

    const store = getLocalOwnershipStore(tmp)
    const first = store.ensureTrustedDesktopCommander()
    results.push(check(
      'first_run_creates_local_commander_without_user_password',
      first.ok === true && first.ok && first.first_run === true && first.auth.identity.role === 'LOCAL_COMMANDER',
      first.ok ? first.auth.identity.id : JSON.stringify(first),
    ))

    results.push(check(
      'session_token_is_not_the_discarded_bootstrap_secret',
      first.ok === true && first.ok && first.auth.token !== secret && first.auth.token.length >= 20,
      'session is independent of desktop trust secret',
    ))

    const verified = store.verifySessionToken(first.ok ? first.auth.token : null)
    results.push(check(
      'issued_session_verifies_against_sqlite',
      Boolean(verified?.identity.id),
      verified?.session.session_id || 'missing',
    ))

    const second = store.ensureTrustedDesktopCommander()
    results.push(check(
      'later_launch_does_not_require_password_or_rebootstrap',
      second.ok === true && second.ok && second.first_run === false && second.auth.token !== (first.ok ? first.auth.token : ''),
      'fresh session, same identity',
    ))

    const passwordLogin = store.login('not-the-discarded-secret-value')
    results.push(check(
      'password_login_not_weakened',
      passwordLogin.ok === false && passwordLogin.ok === false && passwordLogin.code === 'INVALID_CREDENTIALS',
      passwordLogin.ok ? 'unexpected ok' : passwordLogin.code,
    ))

    resetLocalOwnershipStoreSingleton()
    const knownDir = join(tmp, 'known-pw')
    process.env.WAR_ROOM_LOCAL_DATA_DIR = knownDir
    const storePw = getLocalOwnershipStore(knownDir)
    const boot = storePw.bootstrapCommander({ password: 'commander-known-password-ok', displayName: 'Existing' })
    const trustedAfterPassword = storePw.ensureTrustedDesktopCommander()
    results.push(check(
      'existing_password_identity_still_gets_trusted_session',
      boot.ok && trustedAfterPassword.ok === true && trustedAfterPassword.ok && trustedAfterPassword.first_run === false,
      'password store remains; desktop does not prompt',
    ))
    const stillLogsIn = storePw.login('commander-known-password-ok')
    results.push(check(
      'existing_password_login_still_works',
      stillLogsIn.ok === true,
      stillLogsIn.ok ? 'ok' : stillLogsIn.reason,
    ))

    results.push(check(
      'no_plaintext_password_column_or_auto_submit',
      !storeSrc.includes('password_plain') && !panelSrc.includes('auto-fill') && !mainSrc.includes('password:'),
      'ok',
    ))

    results.push(check(
      'middleware_mints_on_desktop_proof_not_packaged_flag',
      middlewareSrc.includes('TRUSTED_DESKTOP_MINT_PATH')
        && middlewareSrc.includes('hasTrustedDesktopPresentation')
        && !middlewareSrc.includes('WAR_ROOM_PACKAGED')
        && middlewareSrc.includes("loginUrl.searchParams.set('next', current)"),
      'Edge only presents; Node verifies',
    ))

    results.push(check(
      'login_page_auto_enters_only_after_node_secret_match',
      loginSrc.includes('verifyDesktopTrustProof') && loginSrc.includes('TRUSTED_DESKTOP_MINT_PATH'),
      'ok',
    ))

    results.push(check(
      'mint_route_requires_loopback_and_secret',
      mintSrc.includes('assertLocalOnlyRequest') && mintSrc.includes('verifyDesktopTrustProof') && mintSrc.includes('ensureTrustedDesktopCommander'),
      'ok',
    ))

    results.push(check(
      'electron_does_not_implement_commander_password_auth',
      !mainSrc.includes('LOCAL_COMMANDER') && mainSrc.includes('desktopTrust') && mainSrc.includes('mintTrustedDesktopSession'),
      'ok',
    ))

    results.push(check(
      'cookie_presentation_still_required_for_ordinary_loopback',
      hasPresentedLocalCommanderSession({ host: '127.0.0.1:3848', cookieHeader: null }) === false,
      'ordinary browser without cookie stays unauthenticated',
    ))

    results.push(check(
      'query_flag_is_not_a_trust_signal',
      !middlewareSrc.includes('searchParams.get(\'desktop\')') && !middlewareSrc.includes('trusted=1'),
      'ok',
    ))

    const tokenShape = createHash('sha256').update('x').digest('hex')
    results.push(check(
      'sha256_still_used_for_session_tokens',
      storeSrc.includes("createHash('sha256')") && tokenShape.length === 64,
      'session tokens remain hashed at rest',
    ))
  } finally {
    resetLocalOwnershipStoreSingleton()
    if (prevDataDir === undefined) delete process.env.WAR_ROOM_LOCAL_DATA_DIR
    else process.env.WAR_ROOM_LOCAL_DATA_DIR = prevDataDir
    if (prevSecret === undefined) delete process.env[DESKTOP_TRUST_ENV]
    else process.env[DESKTOP_TRUST_ENV] = prevSecret
    try {
      rmSync(tmp, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }

  return results
}

export function runTrustedDesktopAuthValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runTrustedDesktopAuthValidation()
  const failed = results.filter(result => !result.pass)
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  console.log(`Trusted desktop auth: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
