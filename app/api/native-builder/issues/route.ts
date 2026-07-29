import { NextResponse } from 'next/server'
import { listIssues, countUnresolvedIssues } from '@/lib/native-builder/storage'
import { reportIssue } from '@/lib/native-builder/runtime'
import {
  issueFromBrowserRuntimeError,
  issueFromCommanderReport,
  issueFromPanelErrorBoundary,
} from '@/lib/native-builder/issueIngest'
import type { NativeIssueIngestInput } from '@/lib/native-builder/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const [issues, unresolvedCount] = await Promise.all([listIssues(), countUnresolvedIssues()])
  return NextResponse.json({ issues, unresolvedCount })
}

type IssueReportBody =
  | { kind: 'panel_error_boundary'; panelLabel: string; errorMessage: string; componentStack?: string }
  | { kind: 'browser_runtime_error'; message: string; source?: string; stack?: string; subsystem?: string }
  | { kind: 'commander_report'; title: string; description: string; subsystem: string; severity?: 'low' | 'medium' | 'high' }

export async function POST(req: Request) {
  let body: IssueReportBody
  try {
    body = (await req.json()) as IssueReportBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  let input: NativeIssueIngestInput
  switch (body.kind) {
    case 'panel_error_boundary':
      if (!body.panelLabel || !body.errorMessage) {
        return NextResponse.json({ error: 'panelLabel and errorMessage are required.' }, { status: 400 })
      }
      input = issueFromPanelErrorBoundary(body)
      break
    case 'browser_runtime_error':
      if (!body.message) {
        return NextResponse.json({ error: 'message is required.' }, { status: 400 })
      }
      input = issueFromBrowserRuntimeError(body)
      break
    case 'commander_report':
      if (!body.title || !body.description || !body.subsystem) {
        return NextResponse.json({ error: 'title, description, and subsystem are required.' }, { status: 400 })
      }
      input = issueFromCommanderReport(body)
      break
    default:
      return NextResponse.json({ error: 'Unknown issue kind.' }, { status: 400 })
  }

  const { issue, repair } = await reportIssue(input)
  return NextResponse.json({ issue, repair })
}
