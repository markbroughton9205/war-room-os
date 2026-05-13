import { NextResponse } from 'next/server'

/** Placeholder route so the file is a valid module; wire real handlers when needed. */
export async function GET() {
  return NextResponse.json({ ok: false, message: 'Conversation API not configured' }, { status: 501 })
}
