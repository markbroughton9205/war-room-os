import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabaseServer'

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

export async function GET() {
  const { supabase, error } = getClientOrError()
  if (error) return error

  const { data, error: queryError } = await supabase
    .from('war_room_files')
    .select('*')
    .order('uploaded_at', { ascending: false })

  if (queryError) {
    return NextResponse.json({
      tool: 'files',
      status: 'error',
      message: queryError.message,
      files: [],
    }, { status: 500 })
  }

  return NextResponse.json({
    tool: 'files',
    status: 'complete',
    files: (data ?? []).map(normalizeFile),
  })
}
