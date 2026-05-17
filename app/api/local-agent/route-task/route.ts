import { NextResponse } from 'next/server'
import { LOCAL_TASK_CATEGORIES, routeLocalTask } from '@/lib/local-agent/router'
import { getLMStudioModels, testLMStudioChat } from '@/lib/local-agent/providers'
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

  const [availableModels, lmStudioProbe] = await Promise.all([
    getOllamaModels(),
    getLMStudioModels(),
  ])
  const lmStudioTest = lmStudioProbe.models.length > 0
    ? await testLMStudioChat(lmStudioProbe.baseUrl, lmStudioProbe.configuredModel)
    : null
  const useLMStudio = Boolean(lmStudioTest?.functional)
  const decision = routeLocalTask({
    taskCategory: body.taskCategory,
    availableModels,
    activeProvider: useLMStudio ? 'lm_studio' : 'ollama',
    activeModel: useLMStudio ? lmStudioTest?.modelUsed ?? lmStudioProbe.configuredModel : null,
    providerFunctional: useLMStudio,
  })

  return NextResponse.json({
    ...decision,
    activeLocalEngine: useLMStudio ? 'lm_studio' : 'ollama',
    lmStudio: {
      reachable: lmStudioProbe.models.length > 0,
      functional: Boolean(lmStudioTest?.functional),
      modelUsed: lmStudioTest?.modelUsed ?? lmStudioProbe.configuredModel,
      failureKind: lmStudioTest?.failureKind ?? lmStudioProbe.failureKind,
    },
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
