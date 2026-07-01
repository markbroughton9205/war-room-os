import { NextResponse } from 'next/server'
import { beginFileUpload, endFileUpload } from '@/lib/filesUploadActivity'
import { createSupabaseServerClient } from '@/lib/supabaseServer'

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/json',
  'text/csv',
  'image/png',
  'image/jpeg',
  'image/webp',
])

const EXTENSION_FALLBACK_MIME: Record<string, string> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  txt: 'text/plain',
  json: 'application/json',
}

type FileRow = Record<string, unknown>

function normalizeFile(row: FileRow) {
  return {
    id: String(row.id ?? ''),
    file_name: String(row.file_name ?? ''),
    file_type: String(row.file_type ?? ''),
    mime_type: String(row.mime_type ?? ''),
    size_bytes: Number(row.size_bytes ?? 0),
    storage_path: String(row.storage_path ?? ''),
    source_context: String(row.source_context ?? 'war-room'),
    uploaded_at: String(row.uploaded_at ?? new Date().toISOString()),
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    status: String(row.status ?? 'uploaded'),
    notes: String(row.notes ?? ''),
  }
}

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 160) || 'war-room-file'
}

function getMimeType(file: File) {
  if (file.type) return file.type
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return EXTENSION_FALLBACK_MIME[extension] ?? 'application/octet-stream'
}

function fileTypeFromName(name: string) {
  return name.split('.').pop()?.toLowerCase() || 'unknown'
}

function configuredBucketName() {
  return process.env.SUPABASE_FILES_BUCKET?.trim() ?? ''
}

function logUploadRouteHealth(status: string, bucket: string) {
  console.info('[Files upload route]', {
    status,
    configuredBucket: bucket || 'not configured',
  })
}

async function getSupabaseOrResponse() {
  try {
    return { supabase: createSupabaseServerClient(), response: null }
  } catch (error) {
    return {
      supabase: null,
      response: NextResponse.json({
        tool: 'files',
        status: 'error',
        message: error instanceof Error ? error.message : 'Supabase server client is not configured',
      }, { status: 500 }),
    }
  }
}

async function validateConfiguredBucket(supabase: ReturnType<typeof createSupabaseServerClient>, bucket: string) {
  if (!bucket) {
    logUploadRouteHealth('not_configured', bucket)
    return NextResponse.json({
      tool: 'files',
      status: 'not_configured',
      message: 'File storage bucket not configured yet.',
      configuredBucket: null,
    }, { status: 503 })
  }

  const { error } = await supabase.storage.getBucket(bucket)
  if (error) {
    logUploadRouteHealth('bucket_missing', bucket)
    return NextResponse.json({
      tool: 'files',
      status: 'bucket_missing',
      message: 'Configured storage bucket not found.',
      configuredBucket: bucket,
    }, { status: 404 })
  }

  logUploadRouteHealth('ready', bucket)
  return null
}

export async function GET() {
  const bucket = configuredBucketName()
  const { supabase, response } = await getSupabaseOrResponse()
  if (response) return response

  const bucketError = await validateConfiguredBucket(supabase, bucket)
  if (bucketError) return bucketError

  return NextResponse.json({
    tool: 'files',
    status: 'ready',
    message: 'Upload route ready.',
    configuredBucket: bucket,
  })
}

export async function POST(req: Request) {
  const bucket = configuredBucketName()
  const { supabase, response } = await getSupabaseOrResponse()
  if (response) return response

  const bucketError = await validateConfiguredBucket(supabase, bucket)
  if (bucketError) return bucketError

  beginFileUpload()
  try {
    let form: FormData
    try {
      form = await req.formData()
    } catch {
      return NextResponse.json({
        tool: 'files',
        status: 'error',
        message: 'A multipart file upload request is required.',
        configuredBucket: bucket,
      }, { status: 400 })
    }

    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({
        tool: 'files',
        status: 'error',
        message: 'A file is required',
      }, { status: 400 })
    }

    const mimeType = getMimeType(file)
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json({
        tool: 'files',
        status: 'error',
        message: 'Unsupported file type',
      }, { status: 400 })
    }

    const fileName = safeFileName(file.name)
    const storagePath = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${fileName}`
    const sourceContext = String(form.get('source_context') ?? 'war-room').trim() || 'war-room'
    const tags = String(form.get('tags') ?? '')
      .split(',')
      .map(tag => tag.trim())
      .filter(Boolean)
    const notes = String(form.get('notes') ?? '').trim()

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(storagePath, file, {
        contentType: mimeType,
        upsert: false,
      })

    if (uploadError) {
      return NextResponse.json({
        tool: 'files',
        status: 'error',
        message: uploadError.message,
      }, { status: 500 })
    }

    const metadata = {
      file_name: file.name,
      file_type: fileTypeFromName(file.name),
      mime_type: mimeType,
      size_bytes: file.size,
      storage_path: storagePath,
      source_context: sourceContext,
      tags,
      status: 'uploaded',
      notes,
    }

    const { data, error: insertError } = await supabase
      .from('war_room_files')
      .insert([metadata])
      .select('*')
      .single()

    if (insertError) {
      return NextResponse.json({
        tool: 'files',
        status: 'error',
        message: insertError.message,
      }, { status: 500 })
    }

    return NextResponse.json({
      tool: 'files',
      status: 'complete',
      message: 'File uploaded',
      file: normalizeFile(data as FileRow),
    })
  } finally {
    endFileUpload()
  }
}
