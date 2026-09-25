/**
 * Installed desktop trust proof (Electron main).
 * Generates/loads a machine-scoped secret, injects it as a request header on
 * loopback UI/core requests, and mints wr_local_session via the Next API.
 * Never logs the secret. Never exposes it to the renderer.
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { resolveAppDataPaths } = require('./appDataRoot.cjs')

const DESKTOP_TRUST_HEADER = 'x-war-room-desktop-trust'
const DESKTOP_TRUST_ENV = 'WAR_ROOM_DESKTOP_TRUST_SECRET'
const DESKTOP_TRUST_FILE = 'desktop-trust.secret'
const DESKTOP_TRUST_MIN_LENGTH = 32
const LOCAL_SESSION_COOKIE = 'wr_local_session'
const TRUSTED_DESKTOP_MINT_PATH = '/api/sovereign/local-auth/trusted-desktop'
const LOOPBACK_PORTS = new Set(['3848', '3847', '3000', '3001'])

function secretFilePath() {
  const paths = resolveAppDataPaths()
  fs.mkdirSync(paths.runtime, { recursive: true })
  return path.join(paths.runtime, DESKTOP_TRUST_FILE)
}

function tighten(filePath) {
  try {
    if (process.platform !== 'win32') fs.chmodSync(filePath, 0o600)
  } catch {
    /* best-effort */
  }
}

function loadOrCreateDesktopTrustSecret() {
  const fromEnv = typeof process.env[DESKTOP_TRUST_ENV] === 'string' ? process.env[DESKTOP_TRUST_ENV].trim() : ''
  const filePath = secretFilePath()
  if (fromEnv.length >= DESKTOP_TRUST_MIN_LENGTH) {
    try {
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, fromEnv, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
        tighten(filePath)
      }
    } catch {
      /* reuse */
    }
    return fromEnv
  }
  try {
    const existing = fs.readFileSync(filePath, 'utf8').trim()
    if (existing.length >= DESKTOP_TRUST_MIN_LENGTH) {
      process.env[DESKTOP_TRUST_ENV] = existing
      return existing
    }
  } catch {
    /* create */
  }
  const created = crypto.randomBytes(32).toString('base64url')
  try {
    fs.writeFileSync(filePath, created, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    tighten(filePath)
    process.env[DESKTOP_TRUST_ENV] = created
    return created
  } catch {
    const raced = fs.readFileSync(filePath, 'utf8').trim()
    if (raced.length >= DESKTOP_TRUST_MIN_LENGTH) {
      process.env[DESKTOP_TRUST_ENV] = raced
      return raced
    }
    throw new Error('Trusted desktop secret file is unreadable.')
  }
}

function isLoopbackWarRoomUrl(raw) {
  try {
    const u = new URL(raw)
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') return false
    const port = u.port || (u.protocol === 'https:' ? '443' : '80')
    return LOOPBACK_PORTS.has(port)
  } catch {
    return false
  }
}

function attachDesktopTrustHeaders(electronSession, secret) {
  if (!electronSession || !secret || typeof electronSession.webRequest?.onBeforeSendHeaders !== 'function') return
  electronSession.webRequest.onBeforeSendHeaders(
    { urls: ['http://127.0.0.1:*/*', 'http://localhost:*/*'] },
    (details, callback) => {
      const headers = details.requestHeaders || {}
      if (isLoopbackWarRoomUrl(details.url)) {
        headers[DESKTOP_TRUST_HEADER] = secret
      }
      callback({ requestHeaders: headers })
    },
  )
}

async function mintTrustedDesktopSession(uiOrigin, secret) {
  if (!secret || secret.length < DESKTOP_TRUST_MIN_LENGTH) return null
  const origin = String(uiOrigin || 'http://127.0.0.1:3848').replace(/\/$/, '')
  const res = await fetch(origin + TRUSTED_DESKTOP_MINT_PATH, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      [DESKTOP_TRUST_HEADER]: secret,
    },
    body: '{}',
    signal: AbortSignal.timeout(8000),
  })
  let body = {}
  try {
    body = await res.json()
  } catch {
    body = {}
  }
  if (!res.ok || !body || body.ok !== true || typeof body.session_token !== 'string') return null
  if (body.session_token.length < 20) return null
  return body.session_token
}

async function applyLocalSessionCookie(electronSession, uiOrigin, token) {
  if (!electronSession || !token || typeof electronSession.cookies?.set !== 'function') return false
  const url = String(uiOrigin || 'http://127.0.0.1:3848').replace(/\/$/, '') + '/'
  await electronSession.cookies.set({
    url,
    name: LOCAL_SESSION_COOKIE,
    value: token,
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    expirationDate: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
  })
  return true
}

module.exports = {
  DESKTOP_TRUST_HEADER,
  DESKTOP_TRUST_ENV,
  DESKTOP_TRUST_FILE,
  DESKTOP_TRUST_MIN_LENGTH,
  LOCAL_SESSION_COOKIE,
  TRUSTED_DESKTOP_MINT_PATH,
  loadOrCreateDesktopTrustSecret,
  attachDesktopTrustHeaders,
  mintTrustedDesktopSession,
  applyLocalSessionCookie,
}
