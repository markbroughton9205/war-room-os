import { NextResponse } from 'next/server'
import { wrimReconciliationStatusPayload } from '@/lib/wrim-reconciliation/status'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json(wrimReconciliationStatusPayload())
}
