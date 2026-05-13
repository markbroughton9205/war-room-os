import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabaseServer'

type FileRow = Record<string, unknown>

const VALID_STATUSES = ['uploaded', 'indexed', 'error']

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
      }, { status: 500 }),
    }
  }
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { supabase, error } = getClientOrError()
  if (error) return error

  const { id } = await context.params
  const body = await req.json()
  const status = body.status ? stringOrDefault(body.status) : undefined
  const notes = body.notes === undefined ? undefined : stringOrDefault(body.notes)
  const tags = Array.isArray(body.tags) ? body.tags.map(String) : undefined

  if (status && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({
      tool: 'files',
      status: 'error',
      message: 'Invalid file status',
    }, { status: 400 })
  }

  const updates = {
    ...(status ? { status } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(tags ? { tags } : {}),
  }

  const { data, error: updateError } = await supabase
    .from('war_room_files')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single()

  if (updateError) {
    return NextResponse.json({
      tool: 'files',
      status: 'error',
      message: updateError.message,
    }, { status: 500 })
  }

  return NextResponse.json({
    tool: 'files',
    status: 'complete',
    message: 'File updated',
    file: normalizeFile(data as FileRow),
  })
}
