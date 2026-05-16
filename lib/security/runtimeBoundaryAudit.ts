import path from 'node:path'

import { SUPABASE_SERVICE_ROLE_ENV } from '@/lib/security/sensitiveEnv'

export type RuntimeBoundaryClassification =
  | 'server_only'
  | 'client_safe'
  | 'shared_safe'
  | 'privileged_runtime'

export type RuntimeBoundaryModule = {
  file: string
  classification: RuntimeBoundaryClassification
  reasons: string[]
}

export type RuntimeBoundaryViolation = {
  id: string
  severity: 'critical' | 'warning' | 'informational'
  kind:
    | 'service_role_client_surface'
    | 'service_role_shared_surface'
    | 'privileged_import_in_client'
    | 'browser_exposed_server_secret'
  file: string
  message: string
  detail?: Record<string, unknown>
}

export type RuntimeBoundaryAudit = {
  modules: RuntimeBoundaryModule[]
  violations: RuntimeBoundaryViolation[]
  serviceRoleFindings: {
    allowed: string[]
    blocked: RuntimeBoundaryViolation[]
  }
}

export type SourceFileForBoundaryAudit = {
  file: string
  content: string
}

const PRIVILEGED_IMPORTS = [
  '@/lib/supabase/admin',
  '@/lib/supabaseServer',
  '@/lib/war-room/persistence',
  '@/lib/security/sensitiveEnv',
]

function toPosix(p: string): string {
  return p.split(path.sep).join('/')
}

function hasUseClient(content: string): boolean {
  return /^\s*['"]use client['"]/.test(content)
}

function isRouteHandler(file: string): boolean {
  return /^app\/api\/.+\/route\.(ts|tsx|js|jsx)$/.test(file)
}

function isPrivilegedFile(file: string, content: string): boolean {
  return isRouteHandler(file)
    || file === 'lib/supabase/admin.ts'
    || file === 'lib/supabaseServer.ts'
    || file === 'lib/war-room/persistence.ts'
    || file === 'lib/security/sensitiveEnv.ts'
    || content.includes('createSupabaseAdminClient')
    || content.includes('tryWarRoomSupabase')
    || content.includes(SUPABASE_SERVICE_ROLE_ENV)
}

export function classifyRuntimeModule(input: SourceFileForBoundaryAudit): RuntimeBoundaryModule {
  const file = toPosix(input.file)
  const reasons: string[] = []

  if (isPrivilegedFile(file, input.content)) {
    reasons.push('privileged Supabase/server runtime access')
    return { file, classification: 'privileged_runtime', reasons }
  }

  if (isRouteHandler(file) || input.content.includes("export const runtime = 'nodejs'")) {
    reasons.push('Next.js server route/runtime')
    return { file, classification: 'server_only', reasons }
  }

  if (hasUseClient(input.content)) {
    reasons.push('client component directive')
    return { file, classification: 'client_safe', reasons }
  }

  if (file.startsWith('components/') || file.startsWith('app/')) {
    reasons.push('React/browser surface without privileged runtime access')
    return { file, classification: 'client_safe', reasons }
  }

  reasons.push('shared utility with no privileged markers')
  return { file, classification: 'shared_safe', reasons }
}

function importsPrivilegedModule(content: string): string[] {
  return PRIVILEGED_IMPORTS.filter(specifier => content.includes(specifier))
}

export function runRuntimeBoundaryAudit(files: SourceFileForBoundaryAudit[]): RuntimeBoundaryAudit {
  const normalized = files.map(file => ({ file: toPosix(file.file), content: file.content }))
  const modules = normalized.map(classifyRuntimeModule)
  const moduleByFile = new Map(modules.map(module => [module.file, module]))
  const violations: RuntimeBoundaryViolation[] = []
  const serviceRoleAllowed: string[] = []

  for (const source of normalized) {
    const boundaryModule = moduleByFile.get(source.file)
    if (!boundaryModule) continue

    const serviceRoleMentioned = source.content.includes(SUPABASE_SERVICE_ROLE_ENV) || /service_role/i.test(source.content)
    if (serviceRoleMentioned) {
      if (boundaryModule.classification === 'privileged_runtime' || boundaryModule.classification === 'server_only') {
        serviceRoleAllowed.push(source.file)
      } else if (boundaryModule.classification === 'client_safe') {
        violations.push({
          id: `svc-client-${source.file}`,
          severity: 'critical',
          kind: 'service_role_client_surface',
          file: source.file,
          message: 'Service-role reference appears in a client/browser surface.',
        })
      } else {
        violations.push({
          id: `svc-shared-${source.file}`,
          severity: 'warning',
          kind: 'service_role_shared_surface',
          file: source.file,
          message: 'Service-role reference appears in shared code; move it behind a server-only runtime boundary.',
        })
      }
    }

    const privilegedImports = importsPrivilegedModule(source.content)
    if (boundaryModule.classification === 'client_safe' && privilegedImports.length > 0) {
      violations.push({
        id: `priv-import-${source.file}`,
        severity: 'critical',
        kind: 'privileged_import_in_client',
        file: source.file,
        message: 'Client surface imports a privileged server module.',
        detail: { imports: privilegedImports },
      })
    }

    if (boundaryModule.classification === 'client_safe' && source.content.includes(SUPABASE_SERVICE_ROLE_ENV)) {
      violations.push({
        id: `browser-env-${source.file}`,
        severity: 'critical',
        kind: 'browser_exposed_server_secret',
        file: source.file,
        message: 'Client surface contains a server-only secret env name.',
      })
    }
  }

  return {
    modules,
    violations,
    serviceRoleFindings: {
      allowed: serviceRoleAllowed.sort(),
      blocked: violations.filter(violation => violation.kind.startsWith('service_role')),
    },
  }
}
