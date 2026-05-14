import { NextResponse } from 'next/server'
import { buildInternetToolMatrix } from '@/lib/internet/probes'
import type { InternetStatusResponse } from '@/lib/tools/internet/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { tools, lastChecked, canUseInternet } = await buildInternetToolMatrix()

  return NextResponse.json({
    tools,
    serverSideOnly: true,
    canUseInternet,
    lastChecked,
  } satisfies InternetStatusResponse)
}
