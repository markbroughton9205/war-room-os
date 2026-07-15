import type { NextRequest } from 'next/server'
import { handleWorkspaceSettingsGet, handleWorkspaceSettingsPatch } from '@/lib/workspace-contributor/routes'

export async function GET() {
  return handleWorkspaceSettingsGet()
}

export async function PATCH(req: NextRequest) {
  return handleWorkspaceSettingsPatch(req)
}
