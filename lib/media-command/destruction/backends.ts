import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { auditBlender } from '../director3d/blender-audit'

export type BackendStatus = 'AVAILABLE' | 'NOT_INSTALLED' | 'NOT_USABLE' | 'UNKNOWN'

function bin(name: string): BackendStatus {
  try {
    execFileSync('which', [name], { stdio: 'ignore', timeout: 2000 })
    return 'AVAILABLE'
  } catch {
    return 'NOT_INSTALLED'
  }
}

export function auditDestructionBackends(): Record<string, BackendStatus> {
  const blender = auditBlender()
  return {
    blender: blender.status === 'AVAILABLE' ? 'AVAILABLE' : 'NOT_INSTALLED',
    bullet: bin('bullet') === 'AVAILABLE' ? 'AVAILABLE' : 'NOT_INSTALLED',
    jolt: bin('jolt'),
    physx: bin('physx'),
    blast: bin('blast'),
    openvdb: bin('vdb_render') === 'AVAILABLE' || bin('vdb_print') === 'AVAILABLE' ? 'AVAILABLE' : 'NOT_INSTALLED',
    nanovdb: bin('nanovdb'),
    usd: bin('usdcat'),
    alembic: bin('abcconvert') === 'AVAILABLE' || bin('abcecho') === 'AVAILABLE' ? 'AVAILABLE' : 'NOT_INSTALLED',
    internalPrimitive: 'AVAILABLE',
    hvsPrevisSolver: 'AVAILABLE',
  }
}

export function backendsRequiringInstallApproval(audit = auditDestructionBackends()): string[] {
  return Object.entries(audit)
    .filter(([name, status]) => status !== 'AVAILABLE' && name !== 'internalPrimitive' && name !== 'hvsPrevisSolver')
    .map(([name]) => name)
}

export const BACKEND_INSTALL_APPROVAL_REQUIRED = 'BACKEND_INSTALL_APPROVAL_REQUIRED'
