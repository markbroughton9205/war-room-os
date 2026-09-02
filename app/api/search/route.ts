import { NextResponse } from 'next/server'
import { searchAcrossCategories } from '@/lib/search/query'
import type { SearchCategory } from '@/lib/search/types'

export const dynamic = 'force-dynamic'

const VALID_CATEGORIES: SearchCategory[] = [
  'conversation', 'memory', 'project', 'open_loop', 'prompt_artifact', 'world_knowledge', 'source', 'claim',
]

export async function GET(req: Request) {
  const url = new URL(req.url)
  const q = url.searchParams.get('q')?.trim()
  if (!q) return NextResponse.json({ error: 'q is required' }, { status: 400 })

  const categoriesParam = url.searchParams.get('categories')
  const categories = categoriesParam
    ? categoriesParam.split(',').filter((c): c is SearchCategory => VALID_CATEGORIES.includes(c as SearchCategory))
    : undefined

  const projectId = url.searchParams.get('projectId')
  const conversationId = url.searchParams.get('conversationId')
  const includeInactive = url.searchParams.get('includeInactive') === '1'
  const limit = Number(url.searchParams.get('limit') ?? '20')

  const results = await searchAcrossCategories({
    query: q,
    categories,
    scope: { projectId: projectId ?? null, conversationId: conversationId ?? null },
    includeInactive,
    limit: Number.isFinite(limit) ? limit : 20,
  })

  return NextResponse.json({ query: q, results })
}
