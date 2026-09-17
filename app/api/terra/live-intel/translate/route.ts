import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { translateLiveIntelText } from '@/lib/terra/liveIntelTranslate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const commander = await requireCommanderSession('Terra live intel translation')
  if (!commander.ok && commander.response.status === 403) return commander.response

  let body: { sourceText?: unknown; sourceLanguage?: unknown }
  try {
    body = await request.json() as { sourceText?: unknown; sourceLanguage?: unknown }
  } catch {
    return NextResponse.json({ ok: false, reason: 'Translation request was not JSON.' }, { status: 400 })
  }

  const sourceText = typeof body.sourceText === 'string' ? body.sourceText : ''
  const sourceLanguage = typeof body.sourceLanguage === 'string' ? body.sourceLanguage : null
  const result = await translateLiveIntelText({ sourceText, sourceLanguage })
  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason, translationState: 'TRANSLATION_FAILED' })
  }
  return NextResponse.json({
    ok: true,
    translation: result.translation,
    translationState: 'TRANSLATED',
  })
}
