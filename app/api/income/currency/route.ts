import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json({
    tool: 'income-currency-conversion',
    status: 'placeholder',
    message: 'Currency conversion route ready. No live conversion provider is connected yet.',
    usd_estimate: null,
  })
}
