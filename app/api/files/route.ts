import { NextResponse } from 'next/server'
import { fileUploadInProgress } from '@/lib/filesUploadActivity'
import { createSupabaseServerClient } from '@/lib/supabaseServer'
import { observeWarRoomApiTool } from '@/lib/modular-intelligence/warRoomToolTrajectoryObserve'

type FileRow = Record<string, unknown>

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

function getClientOrError() {
  try {
    return { supabase: createSupabaseServerClient(), error: null }
  } catch (error) {
    return {
      supabase: null,
      error: NextResponse.json({
        tool: 'files',
        status: 'error',
        message: error instanceof Error ? error.message : 'Supabase server client is not configured',
        files: [],
      }, { status: 500 }),
    }
  }
}

export async function GET(req: Request) {
  const healthOnly = new URL(req.url).searchParams.get('health') === '1'

  const { supabase, error } = getClientOrError()
  if (error) {
    if (healthOnly) {
      return NextResponse.json({
        tool: 'files',
        configured: false,
        bucketReady: false,
        tableReady: false,
        uploading: fileUploadInProgress(),
        message: 'Supabase is not configured for file metadata.',
      }, { status: 503 })
    }
    return error
  }

  if (healthOnly) {
    const bucket = configuredBucketName()
    const uploading = fileUploadInProgress()
    if (!bucket) {
      return NextResponse.json({
        tool: 'files',
        configured: false,
        bucketReady: false,
        tableReady: false,
        uploading,
        message: 'SUPABASE_FILES_BUCKET is not set.',
      })
    }

    const { error: bucketError } = await supabase.storage.getBucket(bucket)
    const { error: tableError } = await supabase.from('war_room_files').select('id').limit(1)

    const bucketReady = !bucketError
    const tableReady = !tableError

    return NextResponse.json({
      tool: 'files',
      configured: bucketReady && tableReady,
      bucketReady,
      tableReady,
      configuredBucket: bucket,
      uploading,
    })
  }

  const { data, error: queryError } = await supabase
    .from('war_room_files')
    .select('*')
    .order('uploaded_at', { ascending: false })

  if (queryError) {
    observeWarRoomApiTool({
      toolId: 'files',
      requestText: 'TOOL=files\npath=list',
      arguments: { path: 'list' },
      ok: false,
      status: 'error',
      error: queryError.message,
      resultMeta: { op: 'list' },
    })
    return NextResponse.json({
      tool: 'files',
      status: 'error',
      message: queryError.message,
      files: [],
    }, { status: 500 })
  }

  observeWarRoomApiTool({
    toolId: 'files',
    requestText: 'TOOL=files\npath=list',
    arguments: { path: 'list' },
    ok: true,
    status: 'complete',
    resultMeta: { op: 'list', count: (data ?? []).length },
  })
  return NextResponse.json({
    tool: 'files',
    status: 'complete',
    files: (data ?? []).map(normalizeFile),
  })
}
