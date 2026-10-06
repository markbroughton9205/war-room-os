import { selectTool } from '../tool-selection/engine'
import type { ToolSelectionInput } from '../tool-selection/types'
import { compileContext } from '../context-compiler/engine'

export function pulsarSelectTool(input: ToolSelectionInput) {
  return selectTool({
    ...input,
    available_tools: input.available_tools.length ? input.available_tools : ['research.web', 'browser.fetch'],
  })
}

export function pulsarCompileContext(input: Parameters<typeof compileContext>[0]) {
  return compileContext({ ...input, role: 'PULSAR' })
}

export function orionSelectTool(input: ToolSelectionInput) {
  return selectTool({
    ...input,
    available_tools: input.available_tools.length ? input.available_tools : ['system.health', 'wr.ports.list', 'wr.council.backend'],
  })
}

export function orionCompileContext(input: Parameters<typeof compileContext>[0]) {
  return compileContext({ ...input, role: 'ORION' })
}
