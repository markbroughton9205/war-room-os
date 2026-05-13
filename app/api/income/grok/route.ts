import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    tool: 'income-grok-live-search',
    status: 'placeholder',
    message: 'Grok/live search integration route ready. No live provider is connected yet.',
    opportunities: [],
  })
}
