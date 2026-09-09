import { WAR_ROOM_BOT_USER_AGENT, type RobotsStatus } from './types'

export type RobotsGroup = {
  userAgents: string[]
  rules: Array<{ allow: boolean; path: string }>
}

export type RobotsDecision = {
  status: RobotsStatus
  matchedPath: string | null
  matchedAllow: boolean | null
  userAgent: string
}

const BOT_UA = 'warroombot'

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

/**
 * Minimal robots.txt parser. robots.txt is a technical crawl signal, not legal authorization.
 */
export function parseRobotsTxt(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = []
  let current: RobotsGroup | null = null
  let pendingAgents: string[] = []

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    if (key === 'user-agent') {
      const agent = value.toLowerCase()
      if (!agent) continue
      if (current && current.rules.length) {
        groups.push(current)
        current = null
        pendingAgents = [agent]
      } else {
        pendingAgents.push(agent)
      }
      continue
    }
    if (key === 'allow' || key === 'disallow') {
      if (!current) {
        current = { userAgents: pendingAgents.length ? pendingAgents : ['*'], rules: [] }
        pendingAgents = []
      }
      current.rules.push({ allow: key === 'allow', path: value })
    }
  }
  if (current) groups.push(current)
  else if (pendingAgents.length) groups.push({ userAgents: pendingAgents, rules: [] })
  return groups
}

function pathMatches(rulePath: string, pathname: string): boolean {
  if (!rulePath) return false
  const decodedRule = decodePath(rulePath)
  const decodedPath = decodePath(pathname)
  if (decodedRule === '/') return true
  const escaped = decodedRule
    .replace(/[.+?^{}()|[\]\\]/g, '\\$&')
    .replace(/\\\*/g, '.*')
    .replace(/\\\$$/, '$')
  const anchored = decodedRule.endsWith('$') ? `^${escaped}` : `^${escaped}`
  try {
    return new RegExp(anchored).test(decodedPath)
  } catch {
    return decodedPath.startsWith(decodedRule)
  }
}

export function evaluateRobotsForPath(robotsText: string, pathname: string, userAgent = WAR_ROOM_BOT_USER_AGENT): RobotsDecision {
  const groups = parseRobotsTxt(robotsText)
  const ua = userAgent.split(/[/\s]/)[0]?.toLowerCase() || BOT_UA
  const specific = groups.find(group => group.userAgents.includes(ua))
  const wildcard = groups.find(group => group.userAgents.includes('*'))
  const group = specific ?? wildcard
  if (!group) {
    return { status: 'ROBOTS_UNKNOWN', matchedPath: null, matchedAllow: null, userAgent }
  }
  if (!group.rules.length) {
    return { status: 'ROBOTS_ALLOWED', matchedPath: null, matchedAllow: true, userAgent }
  }

  let best: { allow: boolean; path: string; length: number } | null = null
  for (const rule of group.rules) {
    if (!pathMatches(rule.path, pathname)) continue
    const length = rule.path.length
    if (!best || length > best.length || (length === best.length && !rule.allow && best.allow)) {
      best = { allow: rule.allow, path: rule.path, length }
    }
  }
  if (!best) {
    return { status: 'ROBOTS_ALLOWED', matchedPath: null, matchedAllow: true, userAgent }
  }
  if (!best.path && !best.allow) {
    return { status: 'ROBOTS_ALLOWED', matchedPath: best.path, matchedAllow: true, userAgent }
  }
  return {
    status: best.allow ? 'ROBOTS_ALLOWED' : 'ROBOTS_DISALLOWED',
    matchedPath: best.path,
    matchedAllow: best.allow,
    userAgent,
  }
}

export function robotsStatusFromFetchFailure(): RobotsDecision {
  return {
    status: 'ROBOTS_FETCH_ERROR',
    matchedPath: null,
    matchedAllow: null,
    userAgent: WAR_ROOM_BOT_USER_AGENT,
  }
}

export function robotsStatusUnknown(): RobotsDecision {
  return {
    status: 'ROBOTS_UNKNOWN',
    matchedPath: null,
    matchedAllow: null,
    userAgent: WAR_ROOM_BOT_USER_AGENT,
  }
}
