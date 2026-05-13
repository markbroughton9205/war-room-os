import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    tool: 'memory',
    status: 'placeholder',
    message: 'Tool route ready but not fully connected yet',
  })
}
