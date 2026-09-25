import { NextResponse } from 'next/server'
import { recoverOperations } from '@/lib/native-builder/foundryOperationsManager'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST() {
  const result = await recoverOperations()
  return NextResponse.json(result)
}
