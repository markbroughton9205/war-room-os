import { NextResponse } from 'next/server'
import { migrateExistingWrCorpus } from '@/lib/wr-corpus/migrate'
import { WrCorpusPolicyError } from '@/lib/wr-corpus/hashes'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST() {
  try {
    const result = await migrateExistingWrCorpus({})
    return NextResponse.json(result)
  } catch (error) {
    const err = error as WrCorpusPolicyError
    return NextResponse.json({ error: err.message, code: err.code }, { status: 400 })
  }
}
