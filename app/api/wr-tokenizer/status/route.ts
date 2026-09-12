import { NextResponse } from 'next/server'
import { wrTokenizerStatusPayload } from '@/lib/wr-tokenizer/status'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json(wrTokenizerStatusPayload())
}
