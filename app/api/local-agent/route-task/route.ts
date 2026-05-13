import { NextResponse } from 'next/server'
import { LOCAL_TASK_CATEGORIES, routeLocalTask } from '@/lib/local-agent/router'
import type { LocalOllamaModel, LocalTaskCategory } from '@/lib/local-agent/types'

export const dynamic = 'force-dynamic'

type RouteTaskRequest = {
  taskCategory?: string
  prompt?: string
  requireApproval?: boolean
}

type OllamaTagsResponse = {
  models?: Array<{
    name?: string
    details?: {
      family?: string
      parameter_size?: string
      quantization_level?: string
    }
  }>
}

async function getOllamaModels(): Promise<LocalOllamaModel[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1800)

  try {
    const response = await fetch('http://localhost:11434/api/tags', {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    })

    if (!response.ok) return []

    const data = await response.json() as OllamaTagsResponse
    return (data.models ?? [])
      .filter(model => Boolean(model.name))
      .map(model => ({
        name: model.name ?? '',
        family: model.details?.family ?? null,
        parameterSize: model.details?.parameter_size ?? null,
        quantization: model.details?.quantization_level ?? null,
      }))
  } catch {
    return []
  } finally {
    clearTimeout(timeout)
  }
}

function isLocalTaskCategory(value: string | undefined): value is LocalTaskCategory {
  return Boolean(value && LOCAL_TASK_CATEGORIES.includes(value as LocalTaskCategory))
}

export async function POST(request: Request) {
  let body: RouteTaskRequest

  try {
    body = await request.json() as RouteTaskRequest
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body.' }, { status: 400 })
  }

  if (!isLocalTaskCategory(body.taskCategory)) {
    return NextResponse.json({
      message: 'Invalid taskCategory.',
      supportedTaskCategories: LOCAL_TASK_CATEGORIES,
    }, { status: 400 })
  }

  const availableModels = await getOllamaModels()
  const decision = routeLocalTask({
    taskCategory: body.taskCategory,
    availableModels,
  })

  return NextResponse.json({
    ...decision,
    promptReceived: Boolean(body.prompt?.trim()),
    approvalRequired: body.requireApproval ?? true,
    canExecute: false,
    rules: [
      'Routing only.',
      'No automatic invocation.',
      'No file modification.',
      'No commits.',
      'No shell commands from UI.',
      'No fake internet or realtime access.',
    ],
  })
}
