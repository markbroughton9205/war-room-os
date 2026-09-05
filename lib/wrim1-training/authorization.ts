import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AuthorizationState } from './types'

export type AuthorizationRecord = {
  run_id: string
  authorization_state: AuthorizationState
  training_status: string
  TRAINING_READY: boolean
  TRAINING_AUTHORIZED: boolean
  TRAINING_STARTED: boolean
}

export function loadAuthorization(repo = process.cwd()): AuthorizationRecord | null {
  const path = join(repo, 'model-lab/manifests/wave9/authorization.json')
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as AuthorizationRecord
}

export function officialStartAllowed(auth: AuthorizationRecord | null): { allowed: boolean; reason: string } {
  if (!auth) return { allowed: false, reason: 'authorization.json missing' }
  if (auth.authorization_state !== 'AUTHORIZED') {
    return { allowed: false, reason: `authorization_state=${auth.authorization_state}` }
  }
  if (auth.TRAINING_AUTHORIZED !== true) return { allowed: false, reason: 'TRAINING_AUTHORIZED is false' }
  if (auth.TRAINING_STARTED === true) return { allowed: false, reason: 'TRAINING_STARTED already true' }
  return { allowed: true, reason: 'authorized' }
}
