import { executeCouncilChatRequest } from './execute'

export async function POST(req: Request) {
  return executeCouncilChatRequest(req)
}
