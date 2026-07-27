import { NextResponse } from 'next/server'
import { listPrograms, listDocuments, listSources, listDatasetManifests, listTokenizerExperiments, listTrainingExperiments, listCheckpoints, listModelManifests } from '@/lib/sovereign-model-lab/storage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const [programs, documents, sources, datasets, tokenizers, trainingPlans, checkpoints, models] = await Promise.all([
    listPrograms(),
    listDocuments(),
    listSources(),
    listDatasetManifests(),
    listTokenizerExperiments(),
    listTrainingExperiments(),
    listCheckpoints(),
    listModelManifests(),
  ])
  return NextResponse.json({
    programs,
    counts: {
      documents: documents.length,
      sources: sources.length,
      datasets: datasets.length,
      tokenizers: tokenizers.length,
      trainingPlans: trainingPlans.length,
      checkpoints: checkpoints.length,
      models: models.length,
    },
  })
}
