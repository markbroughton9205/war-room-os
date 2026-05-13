import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabaseServer'

type ActionRow = Record<string, unknown>

const VALID_STATUSES = ['pending', 'answered', 'expired']

function stringOrDefault(value: unknown, fallback = '') {
  return String(value ?? fallback).trim()
}

function normalizeAction(row: ActionRow) {
  return {
    action_id: stringOrDefault(row.action_id),
    related_opportunity_id: row.related_opportunity_id ? stringOrDefault(row.related_opportunity_id) : null,
    title: stringOrDefault(row.title),
    question: stringOrDefault(row.question),
    response_options: Array.isArray(row.response_options) ? row.response_options.map(String) : [],
    status: stringOrDefault(row.status, 'pending'),
    urgency: stringOrDefault(row.urgency, 'medium'),
    created_at: String(row.created_at ?? new Date().toISOString()),
    expires_at: row.expires_at ? String(row.expires_at) : null,
    source_agent: stringOrDefault(row.source_agent, 'War Room'),
    answered_at: row.answered_at ? String(row.answered_at) : null,
    answer: row.answer ? stringOrDefault(row.answer) : null,
  }
}

function getClientOrError() {
  try {
    return { supabase: createSupabaseServerClient(), error: null }
  } catch (error) {
    return {
      supabase: null,
      error: NextResponse.json({
        tool: 'rael-action-queue',
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
  const actionId = decodeURIComponent(id)
  const body = await req.json()
  const status = stringOrDefault(body.status, 'answered')
  const answer = stringOrDefault(body.answer)

  if (!actionId) {
    return NextResponse.json({
      tool: 'rael-action-queue',
      status: 'error',
      message: 'Action id is required',
    }, { status: 400 })
  }

  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json({
      tool: 'rael-action-queue',
      status: 'error',
      message: 'Invalid action status',
    }, { status: 400 })
  }

  const updates = {
    status,
    answer: answer || null,
    answered_at: status === 'answered' ? new Date().toISOString() : null,
  }

  const { data, error: updateError } = await supabase
    .from('rael_action_queue')
    .update(updates)
    .eq('action_id', actionId)
    .select('*')
    .single()

  if (updateError) {
    return NextResponse.json({
      tool: 'rael-action-queue',
      status: 'error',
      message: updateError.message,
    }, { status: 500 })
  }

  return NextResponse.json({
    tool: 'rael-action-queue',
    status: 'complete',
    message: 'Action updated',
    action: normalizeAction(data as ActionRow),
  })
}
