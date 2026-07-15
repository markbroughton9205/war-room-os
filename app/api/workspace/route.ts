import { handleWorkspaceGet } from '@/lib/workspace-contributor/routes'

export async function GET() {
  return handleWorkspaceGet()
}
