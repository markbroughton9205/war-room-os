import { NextResponse } from 'next/server'
import { readCorpusManifest } from '@/lib/sovereign-model-lab/corpusBuilder'
import { buildProgramProjection } from '@/lib/sovereign-model-lab/programProjection'
import {
  getDatasetManifest,
  getHardwareReport,
  getProgram,
  getTokenizerExperiment,
  getTrainingExperiment,
  listCheckpoints,
  listCorpusVersions,
  listDocuments,
  listModelManifests,
} from '@/lib/sovereign-model-lab/storage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CORPUS_ID = 'WRM-001'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const program = await getProgram(id)
  if (!program) return NextResponse.json({ error: 'Program not found.' }, { status: 404 })

  const [hardware, allDocuments, datasetManifest, tokenizer, trainingPlan, allCheckpoints, allModels, corpusVersions] = await Promise.all([
    program.hardwareReportId ? getHardwareReport(program.hardwareReportId) : Promise.resolve(null),
    listDocuments(),
    program.datasetManifestId ? getDatasetManifest(program.datasetManifestId) : Promise.resolve(null),
    program.tokenizerExperimentId ? getTokenizerExperiment(program.tokenizerExperimentId) : Promise.resolve(null),
    program.trainingExperimentId ? getTrainingExperiment(program.trainingExperimentId) : Promise.resolve(null),
    listCheckpoints(),
    listModelManifests(),
    listCorpusVersions(CORPUS_ID),
  ])

  const documents = allDocuments.filter(d => program.ingestedDocumentIds.includes(d.id))
  const checkpoints = allCheckpoints.filter(cp => cp.trainingExperimentId === program.trainingExperimentId)
  const checkpointIds = new Set(checkpoints.map(cp => cp.checkpointId))
  const models = allModels.filter(m => m.checkpointId && checkpointIds.has(m.checkpointId))
  const corpusManifest = corpusVersions.length ? await readCorpusManifest(CORPUS_ID, corpusVersions.at(-1)!) : null

  const projection = buildProgramProjection({
    program,
    documents,
    datasetManifest,
    corpusManifest,
    tokenizerExperiment: tokenizer,
    trainingExperiment: trainingPlan,
    checkpoints,
    models,
    hardware,
  })

  return NextResponse.json({ program, hardware, documents, datasetManifest, corpusManifest, tokenizer, trainingPlan, projection })
}
