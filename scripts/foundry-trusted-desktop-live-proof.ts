/**
 * Live HTTP proof for trusted-desktop auto-entry vs ordinary/LAN clients.
 * Uses the running loopback UI (:3848). Never prints the desktop trust secret.
 */
import { networkInterfaces } from 'node:os'
import http from 'node:http'
import { readExpectedDesktopTrustSecret } from '@/lib/sovereign-runtime/local-ownership/desktopTrust'
import { DESKTOP_TRUST_HEADER } from '@/lib/sovereign-runtime/local-ownership/desktopTrustShared'

const UI = 'http://127.0.0.1:3848'
const FOUNDRY = `${UI}/war-room/engineering`

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function locationOf(res: Response): string {
  return res.headers.get('location') || ''
}

function requestWithHost(path: string, hostHeader: string, extra: Record<string, string> = {}): Promise<{ status: number; location: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: 3848,
      path,
      method: 'GET',
      headers: { host: hostHeader, ...extra },
    }, res => {
      resolve({ status: res.statusCode || 0, location: String(res.headers.location || '') })
    })
    req.on('error', err => reject(err))
    req.end()
  })
}

function lanAddresses(): string[] {
  const out: string[] = []
  const nets = networkInterfaces()
  for (const rows of Object.values(nets)) {
    for (const row of rows || []) {
      if (row.internal || row.family !== 'IPv4') continue
      if (row.address.startsWith('127.')) continue
      out.push(row.address)
    }
  }
  return out
}

async function run(): Promise<void> {
  const results: CaseResult[] = []
  const secret = readExpectedDesktopTrustSecret()

  const untrusted = await fetch(FOUNDRY, { redirect: 'manual' })
  const untrustedLoc = locationOf(untrusted)
  results.push(check(
    'REMOTE_NEGATIVE_ordinary_browser_still_requires_auth',
    (untrusted.status === 307 || untrusted.status === 302) && /\/login/.test(untrustedLoc),
    `status=${untrusted.status} location=${untrustedLoc || 'none'}`,
  ))

  const wrong = await fetch(FOUNDRY, {
    redirect: 'manual',
    headers: { [DESKTOP_TRUST_HEADER]: 'x'.repeat(40) },
  })
  const wrongLoc = locationOf(wrong)
  const wrongFollow = wrongLoc.includes('/api/sovereign/local-auth/trusted-desktop')
    ? await fetch(new URL(wrongLoc, UI), { redirect: 'manual', headers: { [DESKTOP_TRUST_HEADER]: 'x'.repeat(40) } })
    : wrong
  const wrongFinalLoc = locationOf(wrongFollow)
  results.push(check(
    'wrong_desktop_proof_does_not_authenticate',
    /\/login/.test(wrongFinalLoc) || (wrongFollow.status !== 200 && !String(await wrongFollow.clone().text().catch(() => '')).includes('THE FOUNDRY')),
    `status=${wrongFollow.status} location=${wrongFinalLoc || 'none'}`,
  ))

  let trustedOk = false
  let foundryBody = ''
  let sessionCookie = ''
  if (secret) {
    const minted = await fetch(`${UI}/api/sovereign/local-auth/trusted-desktop`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: UI,
        [DESKTOP_TRUST_HEADER]: secret,
      },
      body: '{}',
    })
    const mintedJson = await minted.json().catch(() => ({})) as {
      ok?: boolean
      auth_mode?: string
      session_token?: string
    }
    const setCookie = minted.headers.get('set-cookie') || ''
    sessionCookie = /wr_local_session=([^;]+)/.exec(setCookie)?.[1] || mintedJson.session_token || ''
    trustedOk = minted.ok && mintedJson.ok === true && mintedJson.auth_mode === 'LOCAL_COMMANDER_TRUSTED' && sessionCookie.length >= 20
    results.push(check(
      'LOCAL_COMMANDER_AUTO_SESSION',
      trustedOk,
      `status=${minted.status} auth_mode=${mintedJson.auth_mode || 'none'} cookie=${sessionCookie ? 'set' : 'missing'}`,
    ))

    if (sessionCookie) {
      const foundry = await fetch(FOUNDRY, {
        redirect: 'follow',
        headers: { cookie: `wr_local_session=${sessionCookie}`, [DESKTOP_TRUST_HEADER]: secret },
      })
      foundryBody = await foundry.text()
      results.push(check(
        'FOUNDRY_DIRECT_ENTRY',
        foundry.status === 200 && foundry.url.includes('/war-room/engineering') && /THE FOUNDRY/.test(foundryBody) && !/LOCAL SIGN IN/.test(foundryBody),
        `status=${foundry.status} url=${foundry.url} foundry=${/THE FOUNDRY/.test(foundryBody)} ready=${/FOUNDRY READY/.test(foundryBody)}`,
      ))

      const sessionRes = await fetch(`${UI}/api/mission-runtime/engineering/foundry/sessions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `wr_local_session=${sessionCookie}`,
        },
        body: JSON.stringify({ title: 'Trusted desktop auto-entry proof', workspaceId: 'war-room-self', projectName: 'WAR ROOM OS' }),
      })
      const sessionJson = await sessionRes.json().catch(() => ({})) as { session?: { id?: string } }
      results.push(check(
        'NEW_SESSION',
        sessionRes.ok && Boolean(sessionJson.session?.id),
        `status=${sessionRes.status} id=${sessionJson.session?.id || 'none'}`,
      ))

      const statusRes = await fetch(`${UI}/api/mission-runtime/engineering/status`, {
        headers: { cookie: `wr_local_session=${sessionCookie}` },
      })
      const statusJson = await statusRes.json().catch(() => ({})) as {
        status?: { foundryModelStatus?: { localModel?: { state?: string; label?: string; model?: string } } }
      }
      const localModel = statusJson.status?.foundryModelStatus?.localModel
      results.push(check(
        'LOCAL_MODEL',
        statusRes.ok && (localModel?.state === 'READY' || localModel?.label === 'LOCAL MODEL READY' || Boolean(localModel?.model)),
        JSON.stringify(localModel || { http: statusRes.status }),
      ))

      const wsRes = await fetch(`${UI}/api/mission-runtime/engineering/workspaces?view=commander`, {
        headers: { cookie: `wr_local_session=${sessionCookie}` },
      })
      const wsJson = await wsRes.json().catch(() => ({})) as { workspaces?: Array<{ id?: string; displayTitle?: string; label?: string }> }
      const labels = (wsJson.workspaces || []).map(item => `${item.id} ${item.displayTitle || ''} ${item.label || ''}`).join(' | ')
      results.push(check(
        'PROJECT_WAR_ROOM_OS',
        (wsJson.workspaces || []).some(item => item.id === 'war-room-self' || /war room os/i.test(`${item.displayTitle || ''} ${item.label || ''}`)),
        labels.slice(0, 400) || `status=${wsRes.status}`,
      ))
    }
  } else {
    results.push(check('LOCAL_COMMANDER_AUTO_SESSION', false, 'desktop trust secret not present on this machine — installed desktop has not initialized it yet'))
  }

  const forgedHost = await requestWithHost(
    '/war-room/engineering',
    '192.168.1.50:3848',
    secret ? { [DESKTOP_TRUST_HEADER]: secret } : {},
  )
  results.push(check(
    'LAN_HOST_HEADER_SPOOF_DENIED',
    ((forgedHost.status === 307 || forgedHost.status === 302) && /\/login/.test(forgedHost.location)) || forgedHost.status === 403 || forgedHost.status === 401,
    `status=${forgedHost.status} location=${forgedHost.location || 'none'}`,
  ))

  const lans = lanAddresses()
  if (lans.length === 0) {
    results.push(check('LAN_BIND_UNREACHABLE', true, 'no non-loopback IPv4 to probe; UI is spawned on 127.0.0.1 only'))
  } else {
    for (const ip of lans.slice(0, 3)) {
      let reachable = false
      let status = 0
      try {
        const res = await fetch(`http://${ip}:3848/war-room/engineering`, {
          redirect: 'manual',
          signal: AbortSignal.timeout(1500),
        })
        reachable = true
        status = res.status
      } catch {
        reachable = false
      }
      results.push(check(
        `LAN_BYPASS_NOT_POSSIBLE_${ip}`,
        !reachable || status !== 200,
        reachable ? `HTTP ${status}` : 'connection refused (loopback bind)',
      ))
    }
  }

  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(item => !item.pass)
  console.log(JSON.stringify({
    passed: results.length - failed.length,
    failed: failed.length,
    foundryReady: /FOUNDRY READY/.test(foundryBody),
    loginWallAbsentOnTrusted: trustedOk && /THE FOUNDRY/.test(foundryBody) && !/LOCAL SIGN IN/.test(foundryBody),
  }))
  if (failed.length) process.exit(1)
}

await run()
