export type ApiRouteLifecycle = 'active' | 'planned' | 'reserved' | 'deprecated' | 'experimental'

export type RouteClassification = {
  apiPath: string
  routeFile: string
  lifecycle: ApiRouteLifecycle
  owner: string
  suppressOrphanNoise: boolean
  notes: string
}

const EXPERIMENTAL_PREFIXES = ['/api/debug']
const RESERVED_PREFIXES = ['/api/local-agent', '/api/orchestration', '/api/workers', '/api/income-workers']
const PLANNED_PREFIXES = ['/api/income/grok']

function startsWithAny(apiPath: string, prefixes: string[]): boolean {
  return prefixes.some(prefix => apiPath === prefix || apiPath.startsWith(`${prefix}/`))
}

export function classifyApiRoute(apiPath: string, routeFile: string): RouteClassification {
  if (apiPath === '/api/conversation') {
    return {
      apiPath,
      routeFile,
      lifecycle: 'deprecated',
      owner: 'legacy-conversation-compat',
      suppressOrphanNoise: true,
      notes: 'Singular legacy route retained for compatibility; plural /api/conversations is canonical.',
    }
  }

  if (startsWithAny(apiPath, EXPERIMENTAL_PREFIXES)) {
    return {
      apiPath,
      routeFile,
      lifecycle: 'experimental',
      owner: 'diagnostics',
      suppressOrphanNoise: true,
      notes: 'Debug diagnostics endpoint; absence of app references is expected.',
    }
  }

  if (startsWithAny(apiPath, RESERVED_PREFIXES)) {
    return {
      apiPath,
      routeFile,
      lifecycle: 'reserved',
      owner: 'future-runtime-architecture',
      suppressOrphanNoise: true,
      notes: 'Reserved runtime/control surface. Keep classified without treating as accidental orphan.',
    }
  }

  if (startsWithAny(apiPath, PLANNED_PREFIXES)) {
    return {
      apiPath,
      routeFile,
      lifecycle: 'planned',
      owner: 'economic-ops',
      suppressOrphanNoise: true,
      notes: 'Planned provider route for future architecture.',
    }
  }

  return {
    apiPath,
    routeFile,
    lifecycle: 'active',
    owner: apiPath.split('/').slice(2, 4).join('/') || 'root-api',
    suppressOrphanNoise: false,
    notes: 'Active route; reference scan is heuristic because routes may be invoked externally.',
  }
}

export function classifyRouteNameOverlap(routeFiles: string[]): {
  basename: string
  routeFiles: string[]
  classification: 'acceptable_shared_name' | 'ambiguous_diagnostics_overlap' | 'accidental_collision'
  message: string
}[] {
  const groups = new Map<string, string[]>()
  for (const routeFile of routeFiles) {
    const parts = routeFile.split('/')
    const basename = parts.at(-2) ?? 'route'
    const rows = groups.get(basename) ?? []
    rows.push(routeFile)
    groups.set(basename, rows)
  }

  return [...groups.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([basename, files]) => {
      const diagnostics = files.filter(file => file.includes('/debug/') || file.includes('/status/'))
      if (basename === 'status') {
        return {
          basename,
          routeFiles: files.sort(),
          classification: 'acceptable_shared_name' as const,
          message: 'Shared status route name is acceptable when each endpoint is namespaced by subsystem.',
        }
      }
      if (diagnostics.length > 1) {
        return {
          basename,
          routeFiles: files.sort(),
          classification: 'ambiguous_diagnostics_overlap' as const,
          message: 'Multiple diagnostics routes share a leaf name; verify panel copy names the namespace.',
        }
      }
      return {
        basename,
        routeFiles: files.sort(),
        classification: 'accidental_collision' as const,
        message: 'Multiple API routes share a leaf name outside status/diagnostics conventions.',
      }
    })
}
