import { NextResponse } from 'next/server'
import {
  authorizeTerminalCwd,
  closeFoundryTerminal,
  readFoundryTerminal,
  startFoundryTerminal,
  writeFoundryTerminal,
} from '@/lib/native-builder/foundryTerminalSession'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 })
  const session = readFoundryTerminal(id)
  if (!session) return NextResponse.json({ error: 'terminal not found.' }, { status: 404 })
  return NextResponse.json({ session })
}

export async function POST(req: Request) {
  let body: { action?: string; id?: string; cwd?: string; data?: string } = {}
  try {
    const raw = await req.json()
    if (raw && typeof raw === 'object') body = raw as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (body.action === 'start') {
    const allowed = authorizeTerminalCwd(body.cwd)
    if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: 403 })
    return NextResponse.json({ session: startFoundryTerminal(allowed.cwd) })
  }
  if (body.action === 'write') {
    if (!body.id) return NextResponse.json({ error: 'id is required.' }, { status: 400 })
    const session = writeFoundryTerminal(body.id, typeof body.data === 'string' ? body.data : '')
    if (!session) return NextResponse.json({ error: 'terminal not found.' }, { status: 404 })
    return NextResponse.json({ session })
  }
  if (body.action === 'close') {
    if (!body.id) return NextResponse.json({ error: 'id is required.' }, { status: 400 })
    const session = closeFoundryTerminal(body.id)
    if (!session) return NextResponse.json({ error: 'terminal not found.' }, { status: 404 })
    return NextResponse.json({ session })
  }
  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
