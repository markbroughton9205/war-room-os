import { NextResponse } from 'next/server'
import { denyInstallUpdate } from '@/lib/native-builder/gitGovernance'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  let body: Record<string, unknown> = {}
  try {
    const raw = await req.json()
    if (raw && typeof raw === 'object') body = raw as Record<string, unknown>
  } catch {
    body = {}
  }
  const denied = denyInstallUpdate()
  return NextResponse.json({
    ...denied,
    approvalGranted: body.approvalGranted === true,
    buildPackage: false,
  }, { status: 403 })
}
