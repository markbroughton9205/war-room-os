export type OpenWorldPrompt = {
  id: string
  prompt: string
  prior?: string[]
  expected_path: 'SHORT_PATH' | 'AGENT_PATH' | 'HANDOFF'
  tool?: 'NONE' | 'BROWSER_SEARCH' | 'SYSTEM_PROBE' | 'FOUNDRY' | 'CALCULATOR' | 'VISION'
  clarify?: boolean
}

/** Generalization set. These must NOT all be encoded as classifier regexes. */
export const OPEN_WORLD_PROMPTS: OpenWorldPrompt[] = [
  { id: 'OW-01', prompt: "What's up Council?", expected_path: 'SHORT_PATH', tool: 'NONE' },
  { id: 'OW-02', prompt: 'Morning. Got a minute?', expected_path: 'SHORT_PATH', tool: 'NONE' },
  { id: 'OW-03', prompt: 'Give me a gut take on mixing local and hosted models.', expected_path: 'SHORT_PATH', tool: 'NONE' },
  { id: 'OW-04', prompt: 'Why is that the better order?', prior: ['I want to make Council smarter before redesigning Home.'], expected_path: 'SHORT_PATH', tool: 'NONE' },
  { id: 'OW-05', prompt: 'Tell me more', prior: ['Sparse experts keep most parameters idle per token.'], expected_path: 'SHORT_PATH', tool: 'NONE' },
  { id: 'OW-06', prompt: 'What is HTTP?', expected_path: 'SHORT_PATH', tool: 'NONE' },
  { id: 'OW-07', prompt: 'Explain TCP vs UDP like I ship browsers.', expected_path: 'SHORT_PATH', tool: 'NONE' },
  { id: 'OW-08', prompt: 'What does PathClassifier do in Divine Council?', expected_path: 'SHORT_PATH', tool: 'NONE' },
  { id: 'OW-09', prompt: 'Walk me through why SHORT_PATH should not spawn six seats.', expected_path: 'SHORT_PATH', tool: 'NONE' },
  { id: 'OW-10', prompt: 'Rewrite this professionally:\nwe need to fix the browser before we add more stuff because it keeps breaking', expected_path: 'SHORT_PATH', tool: 'NONE' },
  { id: 'OW-11', prompt: 'Make that tighter.', prior: ['Rewrite this professionally: we need to fix the browser'], expected_path: 'SHORT_PATH', tool: 'NONE' },
  { id: 'OW-12', prompt: 'Brainstorm three ways to make Council answers feel less robotic.', expected_path: 'SHORT_PATH', tool: 'NONE' },
  { id: 'OW-13', prompt: 'Help me plan a two-hour debugging session for Browser Broker screenshots.', expected_path: 'SHORT_PATH', tool: 'NONE' },
  { id: 'OW-14', prompt: 'What does this function do if it only returns the cosine of two bags of words?', expected_path: 'SHORT_PATH', tool: 'NONE' },
  { id: 'OW-15', prompt: 'If a model needs 12 GB VRAM and another process reserves 5 GB on a 16 GB GPU, can both safely fit at once? Explain the practical problem.', expected_path: 'SHORT_PATH', tool: 'NONE' },
  { id: 'OW-16', prompt: 'Why might a smaller model with better tools outperform a larger model without tools on War Room tasks?', expected_path: 'SHORT_PATH', tool: 'NONE' },
  { id: 'OW-17', prompt: 'Give me three architectural reasons not to put full Cesium on the Home page.', expected_path: 'SHORT_PATH', tool: 'NONE' },
  { id: 'OW-18', prompt: '2+2', expected_path: 'SHORT_PATH', tool: 'CALCULATOR' },
  { id: 'OW-19', prompt: "What's the current Playwright version?", expected_path: 'AGENT_PATH', tool: 'BROWSER_SEARCH' },
  { id: 'OW-20', prompt: 'How much RAM is War Room using right now?', expected_path: 'AGENT_PATH', tool: 'SYSTEM_PROBE' },
  { id: 'OW-21', prompt: 'Status on War Room', expected_path: 'AGENT_PATH', tool: 'SYSTEM_PROBE' },
  { id: 'OW-22', prompt: 'Research the current Playwright guidance for persistent browser profiles and use primary sources.', expected_path: 'AGENT_PATH', tool: 'BROWSER_SEARCH' },
  { id: 'OW-23', prompt: 'My browser just broke', expected_path: 'AGENT_PATH', tool: 'SYSTEM_PROBE' },
  { id: 'OW-24', prompt: 'Browser navigation works but screenshots crash Chromium. Investigate.', expected_path: 'AGENT_PATH', tool: 'SYSTEM_PROBE' },
  { id: 'OW-25', prompt: 'Change the PathClassifier in the repo so it handles X.', expected_path: 'HANDOFF', tool: 'FOUNDRY' },
  { id: 'OW-26', prompt: 'Fix this bug in the repo', expected_path: 'HANDOFF', tool: 'FOUNDRY' },
  { id: 'OW-27', prompt: 'Send this email to the team', expected_path: 'AGENT_PATH', tool: 'NONE' },
  { id: 'OW-28', prompt: 'Normalize this spreadsheet of ports and owners', expected_path: 'AGENT_PATH', tool: 'NONE' },
  { id: 'OW-29', prompt: 'Architecture review of Browser Broker trusted vs ephemeral sessions', expected_path: 'AGENT_PATH', tool: 'NONE' },
  { id: 'OW-30', prompt: 'What does this screenshot show?', expected_path: 'SHORT_PATH', tool: 'VISION' },
  { id: 'OW-31', prompt: 'Can you look at this idea?', expected_path: 'SHORT_PATH', tool: 'NONE' },
  { id: 'OW-32', prompt: 'I keep seeing duplicate Council answers. What usually causes that?', expected_path: 'SHORT_PATH', tool: 'NONE' },
  { id: 'OW-33', prompt: 'Draft a Commander-facing note that the probe failed without dumping tool IDs.', expected_path: 'SHORT_PATH', tool: 'NONE' },
  { id: 'OW-34', prompt: 'Compare RAM and VRAM using War Room as the example.', expected_path: 'SHORT_PATH', tool: 'NONE' },
  { id: 'OW-35', prompt: 'Would Foundry be affected?', prior: ['Moving Playwright auth into the Linux keyring.'], expected_path: 'SHORT_PATH', tool: 'NONE' },
  { id: 'OW-36', prompt: 'Do I need all six Council agents for a greeting?', expected_path: 'SHORT_PATH', tool: 'NONE' },
  { id: 'OW-37', prompt: 'Quick answer: why does War Room need RAM if the model is remote?', expected_path: 'SHORT_PATH', tool: 'NONE' },
  { id: 'OW-38', prompt: 'Deep research current sparse expert inference techniques using primary sources.', expected_path: 'AGENT_PATH', tool: 'BROWSER_SEARCH' },
  { id: 'OW-39', prompt: 'research?', expected_path: 'SHORT_PATH', tool: 'NONE', clarify: true },
  { id: 'OW-40', prompt: 'If verification fails because the browser probe died, what should I tell the Commander?', expected_path: 'SHORT_PATH', tool: 'NONE' },
  { id: 'OW-41', prompt: 'List a simple checklist for promoting a claim to VERIFIED without using that word in the answer if possible.', expected_path: 'SHORT_PATH', tool: 'NONE' },
  { id: 'OW-42', prompt: 'What would break if Home imported Cesium at boot?', expected_path: 'SHORT_PATH', tool: 'NONE' },
  {
    id: 'OW-43',
    prompt: 'Anyway, make that rewrite more concise.',
    prior: [
      'Rewrite this professionally:\nwe need to fix the browser before we add more stuff because it keeps breaking',
      'Now research the latest sparse expert inference work using primary sources.',
    ],
    expected_path: 'SHORT_PATH',
    tool: 'NONE',
  },
]

export const ADVERSARIAL_PROMPTS: OpenWorldPrompt[] = [
  { id: 'ADV-look-idea', prompt: 'Can you look at this idea?', expected_path: 'SHORT_PATH', tool: 'NONE' },
  { id: 'ADV-check-out', prompt: 'check this out', prior: ['I sketched a thinner Council assembly.'], expected_path: 'SHORT_PATH', tool: 'NONE' },
  { id: 'ADV-fix-sentence', prompt: 'fix this sentence: council is being weird today', expected_path: 'SHORT_PATH', tool: 'NONE' },
  { id: 'ADV-fix-bug', prompt: 'fix this bug', expected_path: 'HANDOFF', tool: 'FOUNDRY' },
  { id: 'ADV-what-happened', prompt: 'what happened?', prior: ['The last research failed because the browser probe died.'], expected_path: 'SHORT_PATH', tool: 'NONE' },
  { id: 'ADV-research-q', prompt: 'research?', expected_path: 'SHORT_PATH', tool: 'NONE', clarify: true },
  { id: 'ADV-do-it', prompt: 'do it', prior: ['Fix the Divine Council session naming bug.'], expected_path: 'HANDOFF', tool: 'FOUNDRY' },
  { id: 'ADV-look-up', prompt: 'look it up', prior: ['current Playwright version'], expected_path: 'AGENT_PATH', tool: 'BROWSER_SEARCH' },
  { id: 'ADV-look-up-bare', prompt: 'look it up', expected_path: 'SHORT_PATH', tool: 'NONE', clarify: true },
  { id: 'ADV-tell-more', prompt: 'tell me more', prior: ['Sparse experts route each token through a few experts.'], expected_path: 'SHORT_PATH', tool: 'NONE' },
  { id: 'ADV-sure', prompt: 'are you sure?', prior: ['Remote inference does not remove the local runtime.'], expected_path: 'SHORT_PATH', tool: 'NONE' },
]
