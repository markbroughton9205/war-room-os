import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabaseServer'

type ActionRow = Record<string, unknown>

const VALID_STATUSES = ['pending', 'answered', 'expired']
const VALID_URGENCIES = ['low', 'medium', 'high']

function stringOrDefault(value: unknown, fallback = '') {
  return String(value ?? fallback).trim()
}

function stringArrayOrDefault(value: unknown, fallback: string[] = []) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : fallback
}

function normalizeAction(row: ActionRow) {
  return {
    action_id: stringOrDefault(row.action_id),
    related_opportunity_id: row.related_opportunity_id ? stringOrDefault(row.related_opportunity_id) : null,
    title: stringOrDefault(row.title),
    question: stringOrDefault(row.question),
    response_options: stringArrayOrDefault(row.response_options),
    status: VALID_STATUSES.includes(stringOrDefault(row.status)) ? stringOrDefault(row.status) : 'pending',
    urgency: VALID_URGENCIES.includes(stringOrDefault(row.urgency)) ? stringOrDefault(row.urgency) : 'medium',
    created_at: String(row.created_at ?? new Date().toISOString()),
    expires_at: row.expires_at ? String(row.expires_at) : null,
    source_agent: stringOrDefault(row.source_agent, 'War Room'),
    answered_at: row.answered_at ? String(row.answered_at) : null,
    answer: row.answer ? stringOrDefault(row.answer) : null,
  }
}

function actionFromBody(body: ActionRow) {
  const responseOptions = stringArrayOrDefault(body.response_options)

  return {
    action_id: stringOrDefault(body.action_id),
    related_opportunity_id: body.related_opportunity_id ? stringOrDefault(body.related_opportunity_id) : null,
    title: stringOrDefault(body.title),
    question: stringOrDefault(body.question),
    response_options: responseOptions.length ? responseOptions : ['Approve', 'Decline'],
    status: VALID_STATUSES.includes(stringOrDefault(body.status)) ? stringOrDefault(body.status) : 'pending',
    urgency: VALID_URGENCIES.includes(stringOrDefault(body.urgency)) ? stringOrDefault(body.urgency) : 'medium',
    expires_at: body.expires_at ? String(body.expires_at) : null,
    source_agent: stringOrDefault(body.source_agent, 'War Room'),
    answered_at: body.answered_at ? String(body.answered_at) : null,
    answer: body.answer ? stringOrDefault(body.answer) : null,
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
        actions: [],
      }, { status: 500 }),
    }
  }
}

export async function GET() {
  const { supabase, error } = getClientOrError()
  if (error) return error

  const { data, error: queryError } = await supabase
    .from('rael_action_queue')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (queryError) {
    return NextResponse.json({
      tool: 'rael-action-queue',
      status: 'error',
      message: queryError.message,
      actions: [],
    }, { status: 500 })
  }

  return NextResponse.json({
    tool: 'rael-action-queue',
    status: 'complete',
    actions: (data ?? []).map(normalizeAction),
  })
}

export async function POST(req: Request) {
  const { supabase, error } = getClientOrError()
  if (error) return error

  const body = await req.json()
  const action = actionFromBody(body)

  if (!action.action_id || !action.title || !action.question) {
    return NextResponse.json({
      tool: 'rael-action-queue',
      status: 'error',
      message: 'action_id, title, and question are required',
    }, { status: 400 })
  }

  const { data, error: upsertError } = await supabase
    .from('rael_action_queue')
    .upsert([action], { onConflict: 'action_id' })
    .select('*')
    .single()

  if (upsertError) {
    return NextResponse.json({
      tool: 'rael-action-queue',
      status: 'error',
      message: upsertError.message,
    }, { status: 500 })
  }

  return NextResponse.json({
    tool: 'rael-action-queue',
    status: 'complete',
    message: 'Action queued',
    action: normalizeAction(data as ActionRow),
  })
}
