import { NextResponse } from 'next/server'
import { fileUploadInProgress } from '@/lib/filesUploadActivity'
import { createSupabaseServerClient } from '@/lib/supabaseServer'

type FileRow = Record<string, unknown>

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function stringOrDefault(value: unknown, fallback = '') {
  return String(value ?? fallback).trim()
}

function normalizeFile(row: FileRow) {
  return {
    id: stringOrDefault(row.id),
    file_name: stringOrDefault(row.file_name),
    file_type: stringOrDefault(row.file_type),
    mime_type: stringOrDefault(row.mime_type),
    size_bytes: Number(row.size_bytes ?? 0),
    storage_path: stringOrDefault(row.storage_path),
    source_context: stringOrDefault(row.source_context, 'war-room'),
    uploaded_at: String(row.uploaded_at ?? new Date().toISOString()),
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    status: stringOrDefault(row.status, 'uploaded'),
    notes: stringOrDefault(row.notes),
  }
}

function configuredBucketName() {
  return process.env.SUPABASE_FILES_BUCKET?.trim() ?? ''
}

export async function GET(req: Request) {
  const healthOnly = new URL(req.url).searchParams.get('health') === '1'
  let supabase: ReturnType<typeof createSupabaseServerClient>
  try {
    supabase = createSupabaseServerClient()
  } catch (error) {
    return NextResponse.json({
      tool: 'files',
      status: 'error',
      configured: false,
      bucketReady: false,
      tableReady: false,
      uploading: fileUploadInProgress(),
      message: error instanceof Error ? error.message : 'Supabase server client is not configured for Files / Evidence Vault.',
      files: [],
    }, { status: 503, headers: { 'cache-control': 'no-store' } })
  }

  if (healthOnly) {
    const bucket = configuredBucketName()
    const uploading = fileUploadInProgress()
    if (!bucket) {
      return NextResponse.json({
        tool: 'files',
        status: 'config_needed',
        configured: false,
        bucketReady: false,
        tableReady: false,
        uploading,
        message: 'SUPABASE_FILES_BUCKET is not set.',
      }, { headers: { 'cache-control': 'no-store' } })
    }

    const { error: bucketError } = await supabase.storage.getBucket(bucket)
    const { error: tableError } = await supabase.from('war_room_files').select('id').limit(1)
    const bucketReady = !bucketError
    const tableReady = !tableError

    return NextResponse.json({
      tool: 'files',
      status: bucketReady && tableReady ? 'complete' : 'config_needed',
      configured: bucketReady && tableReady,
      bucketReady,
      tableReady,
      configuredBucket: bucket,
      uploading,
      message: bucketReady && tableReady
        ? 'Files / Evidence Vault metadata and storage bucket are reachable.'
        : bucketReady
          ? 'Configured storage table not found or inaccessible.'
          : 'Configured storage bucket not found.',
    }, { headers: { 'cache-control': 'no-store' } })
  }

  const { data, error } = await supabase
    .from('war_room_files')
    .select('*')
    .order('uploaded_at', { ascending: false })

  if (error) {
    return NextResponse.json({
      tool: 'files',
      status: 'error',
      message: error.message,
      files: [],
    }, { status: 500, headers: { 'cache-control': 'no-store' } })
  }

  return NextResponse.json({
    tool: 'files',
    status: 'complete',
    message: 'Files / Evidence Vault metadata is connected to Supabase.',
    files: (data ?? []).map(normalizeFile),
  }, { headers: { 'cache-control': 'no-store' } })
}
