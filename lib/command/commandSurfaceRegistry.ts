export type CommandSurfaceRole =
  | 'primary_decree'
  | 'secondary_router_preview'
  | 'database_thread_message'
  | 'structured_form_notes'
  | 'read_only_diagnostics'

export type CommandSurfaceDefinition = {
  id: string
  file: string
  role: CommandSurfaceRole
  owner: string
  stateField: string
  submitsTo: string
  primary: boolean
  focusPriority: number
  notes: string
}

export type CommandSurfaceAudit = {
  primarySurfaceId: string | null
  duplicatePrimaryCount: number
  shadowComposerCount: number
  surfaces: CommandSurfaceDefinition[]
}

export const COMMAND_SURFACE_REGISTRY: CommandSurfaceDefinition[] = [
  {
    id: 'live-council-primary-decree',
    file: 'app/page.tsx',
    role: 'primary_decree',
    owner: 'Live council form',
    stateField: 'command',
    submitsTo: 'handleDecree -> submitDecree',
    primary: true,
    focusPriority: 100,
    notes: 'The only council decree composer. Enter submits the active decree to family routing.',
  },
  {
    id: 'engine-command-router-preview',
    file: 'app/page.tsx',
    role: 'secondary_router_preview',
    owner: 'CommandRouterPanel',
    stateField: 'text',
    submitsTo: '/api/engine-control/route-command',
    primary: false,
    focusPriority: 20,
    notes: 'Policy/routing preview only. It does not invoke council chat or own decree state.',
  },
  {
    id: 'phase3-thread-message',
    file: 'components/war-room/phase3/Phase3WarRoomPanels.tsx',
    role: 'database_thread_message',
    owner: 'Phase 3 conversation inspector',
    stateField: 'msgDraft',
    submitsTo: '/api/conversations/[id]/messages',
    primary: false,
    focusPriority: 10,
    notes: 'Database thread utility. Operator mode directs users back to the main live chat strip.',
  },
  {
    id: 'files-vault-notes',
    file: 'app/page.tsx',
    role: 'structured_form_notes',
    owner: 'Files evidence vault',
    stateField: 'notes',
    submitsTo: '/api/files/upload',
    primary: false,
    focusPriority: 0,
    notes: 'Upload metadata, not a command composer.',
  },
]

export function auditCommandSurfaces(): CommandSurfaceAudit {
  const primary = COMMAND_SURFACE_REGISTRY.filter(surface => surface.primary)
  return {
    primarySurfaceId: primary[0]?.id ?? null,
    duplicatePrimaryCount: Math.max(0, primary.length - 1),
    shadowComposerCount: COMMAND_SURFACE_REGISTRY.filter(surface =>
      !surface.primary && surface.role === 'primary_decree',
    ).length,
    surfaces: COMMAND_SURFACE_REGISTRY,
  }
}
