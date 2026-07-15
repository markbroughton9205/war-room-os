import { POST as postCouncilChat } from '@/app/api/chat/route'
import { handleCouncilTraceTestRun, handleCouncilTraceTestStatus } from '@/lib/council/traceTestRoute'

export async function GET(request: Request): Promise<Response> {
  return handleCouncilTraceTestStatus(request)
}

export async function POST(request: Request): Promise<Response> {
  return handleCouncilTraceTestRun(request, { chatPost: postCouncilChat })
}
