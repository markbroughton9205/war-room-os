export type ToolStatus = 'idle' | 'scanning' | 'active' | 'complete' | 'error'
export type ToolId = 'web' | 'memory' | 'files' | 'research' | 'repo' | 'deployments'

export type WarRoomTool = {
  id: ToolId
  name: string
  status: ToolStatus
  description: string
  requiresAuth: boolean
  endpoint: string
}

export const TOOL_REGISTRY: WarRoomTool[] = [
  {
    id: 'web',
    name: 'Web',
    status: 'idle',
    description: 'External web lookup and page retrieval foundation.',
    requiresAuth: false,
    endpoint: '/api/tools/web',
  },
  {
    id: 'memory',
    name: 'Memory',
    status: 'idle',
    description: 'Session and long-term memory retrieval foundation.',
    requiresAuth: true,
    endpoint: '/api/tools/memory',
  },
  {
    id: 'files',
    name: 'Files',
    status: 'idle',
    description: 'Workspace file inspection and artifact handling foundation.',
    requiresAuth: true,
    endpoint: '/api/tools/files',
  },
  {
    id: 'research',
    name: 'Research',
    status: 'idle',
    description: 'Multi-source research synthesis foundation.',
    requiresAuth: false,
    endpoint: '/api/tools/research',
  },
  {
    id: 'repo',
    name: 'Repo',
    status: 'idle',
    description: 'Repository status, diffs, patches, and commit workflow foundation.',
    requiresAuth: true,
    endpoint: '/api/tools/repo',
  },
  {
    id: 'deployments',
    name: 'Deployments',
    status: 'idle',
    description: 'Deployment status and release workflow foundation.',
    requiresAuth: true,
    endpoint: '/api/tools/deployments',
  },
]

export function getToolById(id: ToolId) {
  return TOOL_REGISTRY.find(tool => tool.id === id)
}
