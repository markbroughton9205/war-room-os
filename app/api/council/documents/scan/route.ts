import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { extractRelevantSections } from '@/lib/documents/councilDocumentScan'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ScanRequestBody = {
  fileId?: string
  objective?: string
}

function configuredBucketName(): string {
  return process.env.SUPABASE_FILES_BUCKET?.trim() ?? ''
}

export async function POST(req: Request) {
  const commander = await requireCommanderSession('Council document scan')
  if (!commander.ok) return commander.response

  let body: ScanRequestBody = {}
  try {
    body = await req.json() as ScanRequestBody
  } catch {
    return NextResponse.json({
      tool: 'council-document-scan',
      status: 'error',
      message: 'A JSON body with fileId is required.',
    }, { status: 400 })
  }

  const fileId = typeof body.fileId === 'string' ? body.fileId.trim() : ''
  const objective = typeof body.objective === 'string' ? body.objective.trim() : ''

  if (!fileId) {
    return NextResponse.json({
      tool: 'council-document-scan',
      status: 'error',
      message: 'fileId is required.',
    }, { status: 400 })
  }

  const bucket = configuredBucketName()
  if (!bucket) {
    return NextResponse.json({
      tool: 'council-document-scan',
      status: 'not_configured',
      message: 'File storage bucket not configured.',
    }, { status: 503 })
  }

  const supabase = createSupabaseAdminClient()

  const { data: fileRow, error: fileError } = await supabase
    .from('war_room_files')
    .select('*')
    .eq('id', fileId)
    .single()

  if (fileError || !fileRow) {
    return NextResponse.json({
      tool: 'council-document-scan',
      status: 'not_found',
      message: 'File record not found. Upload the document via /api/files/upload first.',
    }, { status: 404 })
  }

  const storagePath = String((fileRow as Record<string, unknown>).storage_path ?? '')
  const mimeType = String((fileRow as Record<string, unknown>).mime_type ?? '')
  const fileName = String((fileRow as Record<string, unknown>).file_name ?? 'document')

  const { data: fileBlob, error: downloadError } = await supabase.storage
    .from(bucket)
    .download(storagePath)

  if (downloadError || !fileBlob) {
    return NextResponse.json({
      tool: 'council-document-scan',
      status: 'error',
      message: 'Could not retrieve the file from storage.',
    }, { status: 500 })
  }

  const buffer = Buffer.from(await fileBlob.arrayBuffer())
  const result = extractRelevantSections({ mimeType, fileName, buffer, objective })

  // Never log extracted/raw file content — metadata only.
  console.info('[Council document scan]', {
    fileId,
    fileName,
    mimeType,
    objectiveLength: objective.length,
    status: result.status,
    excerptCount: result.excerpts.length,
  })

  return NextResponse.json({
    tool: 'council-document-scan',
    status: result.status,
    message: result.message,
    fileId,
    fileName,
    excerpts: result.excerpts,
    // This is a per-request analysis result, not a durable memory write.
    durableMemoryWritten: false,
  })
}
