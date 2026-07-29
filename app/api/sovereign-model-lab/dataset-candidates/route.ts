import { NextResponse } from 'next/server'
import { listDatasetManifests } from '@/lib/sovereign-model-lab/storage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const manifests = await listDatasetManifests()
  return NextResponse.json({ manifests })
}
