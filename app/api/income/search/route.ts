import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    tool: 'income-web-opportunity-search',
    status: 'placeholder',
    message: 'Web opportunity search route ready. No scraping or live search is connected yet.',
    opportunities: [],
  })
}
