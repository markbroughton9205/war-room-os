import { NextResponse } from 'next/server'
import { listProviderFamilyStatus } from '@/lib/council/providerDirectCall'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Phase I — Provider Experience. Read-only, honest configuration status for every sanctioned
 * provider family, straight from lib/council/providerDirectCall.ts's listProviderFamilyStatus()
 * (the same synchronous, no-network-call check every hosted call already performs at call time).
 * Lets the Engineering Mission UI grey out / label an unconfigured family in its provider picker
 * rather than let the Commander select one that will just fail — never asserts a family is
 * reachable, only that its credential is present in this environment.
 */
export async function GET() {
  return NextResponse.json({ providers: listProviderFamilyStatus() })
}
