import { NextResponse } from 'next/server'
import { denyDeploy } from '@/lib/native-builder/gitGovernance'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST() {
  return NextResponse.json(denyDeploy(), { status: 403 })
}
