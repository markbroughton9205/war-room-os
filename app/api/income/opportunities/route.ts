import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabaseServer'

type OpportunityRow = Record<string, unknown>

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function stringOrDefault(value: unknown, fallback = '') {
  return String(value ?? fallback).trim()
}

function normalizeOpportunity(row: OpportunityRow) {
  return {
    id: String(row.id ?? ''),
    title: stringOrDefault(row.title),
    platform: stringOrDefault(row.platform),
    country: stringOrDefault(row.country),
    currency: stringOrDefault(row.currency, 'USD').toUpperCase(),
    local_payout: numberOrNull(row.local_payout),
    usd_estimate: numberOrNull(row.usd_estimate),
    estimated_hourly: numberOrNull(row.estimated_hourly),
    payout_speed: stringOrDefault(row.payout_speed),
    type: stringOrDefault(row.type, 'user testing'),
    risk_level: stringOrDefault(row.risk_level, 'medium'),
    status: stringOrDefault(row.status, 'not started'),
    apply_url: stringOrDefault(row.apply_url),
    notes: stringOrDefault(row.notes),
    expires_at: row.expires_at ? String(row.expires_at) : null,
    discovered_at: String(row.discovered_at ?? row.created_at ?? new Date().toISOString()),
    last_checked_at: row.last_checked_at ? String(row.last_checked_at) : null,
    is_active: Boolean(row.is_active ?? true),
    created_at: String(row.created_at ?? new Date().toISOString()),
  }
}

function opportunityFromBody(body: OpportunityRow) {
  return {
    title: stringOrDefault(body.title),
    platform: stringOrDefault(body.platform),
    country: stringOrDefault(body.country),
    currency: stringOrDefault(body.currency, 'USD').toUpperCase(),
    local_payout: numberOrNull(body.local_payout),
    usd_estimate: numberOrNull(body.usd_estimate),
    estimated_hourly: numberOrNull(body.estimated_hourly),
    payout_speed: stringOrDefault(body.payout_speed),
    type: stringOrDefault(body.type, 'user testing'),
    risk_level: stringOrDefault(body.risk_level, 'medium'),
    status: stringOrDefault(body.status, 'not started'),
    apply_url: stringOrDefault(body.apply_url),
    notes: stringOrDefault(body.notes),
    expires_at: body.expires_at ? String(body.expires_at) : null,
    discovered_at: body.discovered_at ? String(body.discovered_at) : new Date().toISOString(),
    last_checked_at: body.last_checked_at ? String(body.last_checked_at) : new Date().toISOString(),
    is_active: Boolean(body.is_active ?? true),
  }
}

function getClientOrError() {
  try {
    return { supabase: createSupabaseServerClient(), error: null }
  } catch (error) {
    return {
      supabase: null,
      error: NextResponse.json({
        tool: 'income-opportunities',
        status: 'error',
        message: error instanceof Error ? error.message : 'Supabase server client is not configured',
        opportunities: [],
      }, { status: 500 }),
    }
  }
}

export async function GET() {
  const { supabase, error } = getClientOrError()
  if (error) return error

  const { data, error: queryError } = await supabase
    .from('income_opportunities')
    .select('*')
    .order('created_at', { ascending: false })

  if (queryError) {
    return NextResponse.json({
      tool: 'income-opportunities',
      status: 'error',
      message: queryError.message,
      opportunities: [],
    }, { status: 500 })
  }

  return NextResponse.json({
    tool: 'income-opportunities',
    status: 'complete',
    opportunities: (data ?? []).map(normalizeOpportunity),
  })
}

export async function POST(req: Request) {
  const { supabase, error } = getClientOrError()
  if (error) return error

  const body = await req.json()
  const opportunity = opportunityFromBody(body)

  if (!opportunity.title || !opportunity.platform) {
    return NextResponse.json({
      tool: 'income-opportunities',
      status: 'error',
      message: 'Title and platform are required',
    }, { status: 400 })
  }

  const { data, error: insertError } = await supabase
    .from('income_opportunities')
    .insert([opportunity])
    .select('*')
    .single()

  if (insertError) {
    return NextResponse.json({
      tool: 'income-opportunities',
      status: 'error',
      message: insertError.message,
    }, { status: 500 })
  }

  return NextResponse.json({
    tool: 'income-opportunities',
    status: 'complete',
    message: 'Opportunity saved',
    opportunity: normalizeOpportunity(data as OpportunityRow),
  })
}

export async function PATCH(req: Request) {
  const { supabase, error } = getClientOrError()
  if (error) return error

  const body = await req.json()
  const id = stringOrDefault(body.id)

  if (!id) {
    return NextResponse.json({
      tool: 'income-opportunities',
      status: 'error',
      message: 'Opportunity id is required',
    }, { status: 400 })
  }

  const updates = {
    expires_at: body.expires_at ? String(body.expires_at) : null,
    is_active: Boolean(body.is_active ?? false),
    last_checked_at: new Date().toISOString(),
  }

  const { data, error: updateError } = await supabase
    .from('income_opportunities')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single()

  if (updateError) {
    return NextResponse.json({
      tool: 'income-opportunities',
      status: 'error',
      message: updateError.message,
    }, { status: 500 })
  }

  return NextResponse.json({
    tool: 'income-opportunities',
    status: 'complete',
    message: 'Opportunity updated',
    opportunity: normalizeOpportunity(data as OpportunityRow),
  })
}
