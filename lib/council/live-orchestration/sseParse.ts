export function splitSseFrames(buffer: string): { frames: string[]; rest: string } {
  const buf = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const parts = buf.split(/\n\n/)
  let rest = parts.pop() ?? ''
  const frames = parts.filter(Boolean)
  const lines = rest.split('\n')
  rest = lines.pop() ?? ''
  for (const line of lines) {
    if (line.trim()) frames.push(line)
  }
  return { frames, rest }
}

export function parseSseFrame(frame: string): { event: string | null; data: string } {
  let event: string | null = null
  const dataLines: string[] = []
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
  }
  return { event, data: dataLines.join('\n') }
}

export async function readSseResponse(
  response: Response,
  onFrame: (frame: { event: string | null; data: string }) => void | Promise<void>,
): Promise<void> {
  if (!response.body) throw new Error('stream_missing_body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const split = splitSseFrames(buffer)
    buffer = split.rest
    for (const frame of split.frames) {
      await onFrame(parseSseFrame(frame))
    }
  }
  buffer += decoder.decode()
  if (buffer.trim()) await onFrame(parseSseFrame(buffer))
}
