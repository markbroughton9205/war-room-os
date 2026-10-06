export type GoldPrompt = {
  id: string
  prompt: string
  prior?: string[]
  expected_path: 'SHORT_PATH' | 'AGENT_PATH' | 'HANDOFF'
  expected_seats_max: number
  tool: 'NONE' | 'CALCULATOR' | 'SYSTEM_PROBE' | 'BROWSER_SEARCH' | 'FOUNDRY'
  authority: 'none' | 'foundry_stub' | 'no_email_send'
  qualities: string[]
  failure: string
}

export const WAR_ROOM_GOLD_PROMPTS: GoldPrompt[] = [
  {
    id: 'GOLD-RAM',
    prompt: 'Why does War Room need RAM if the model is remote?',
    expected_path: 'SHORT_PATH',
    expected_seats_max: 0,
    tool: 'NONE',
    authority: 'none',
    qualities: ['answers first', 'local runtime vs remote model'],
    failure: 'Spawns EBC or claims the remote model uses local VRAM as RAM',
  },
  {
    id: 'GOLD-STATUS',
    prompt: 'Status on War Room.',
    expected_path: 'AGENT_PATH',
    expected_seats_max: 5,
    tool: 'SYSTEM_PROBE',
    authority: 'none',
    qualities: ['existing EBC status assembly', 'not six seats'],
    failure: 'SHORT_PATH with invented READY',
  },
  {
    id: 'GOLD-SPARSE',
    prompt: 'Research current sparse expert inference techniques using primary sources.',
    expected_path: 'AGENT_PATH',
    expected_seats_max: 5,
    tool: 'BROWSER_SEARCH',
    authority: 'none',
    qualities: ['DEEP_RESEARCH or CURRENT_INTEL', 'PULSAR'],
    failure: 'SHORT_PATH without sources',
  },
  {
    id: 'GOLD-BROKER-EXPLAIN',
    prompt: "Explain what the Browser Broker does like I'm new to it.",
    expected_path: 'SHORT_PATH',
    expected_seats_max: 0,
    tool: 'NONE',
    authority: 'none',
    qualities: ['plain language', 'no scrape-from-chat'],
    failure: 'Launches Broker fetch',
  },
  {
    id: 'GOLD-SESSION-BUG',
    prompt: 'Fix the Divine Council session naming bug.',
    expected_path: 'HANDOFF',
    expected_seats_max: 0,
    tool: 'FOUNDRY',
    authority: 'foundry_stub',
    qualities: ['executed false'],
    failure: 'Council mutates git',
  },
  {
    id: 'GOLD-PROFILES',
    prompt: 'Compare Browser Broker trusted profiles with ephemeral sessions.',
    expected_path: 'SHORT_PATH',
    expected_seats_max: 0,
    tool: 'NONE',
    authority: 'none',
    qualities: ['trusted vs ephemeral'],
    failure: 'Treats compare as live browse',
  },
  {
    id: 'GOLD-KEYRING',
    prompt: 'What would break if we moved Playwright auth state into the Linux keyring?',
    expected_path: 'SHORT_PATH',
    expected_seats_max: 0,
    tool: 'NONE',
    authority: 'none',
    qualities: ['impact analysis', 'Foundry/ephemeral mentioned if relevant'],
    failure: 'Foundry execution',
  },
  {
    id: 'GOLD-PROFESSIONAL',
    prompt: 'Make this message sound professional.',
    expected_path: 'SHORT_PATH',
    expected_seats_max: 0,
    tool: 'NONE',
    authority: 'none',
    qualities: ['rewrite path'],
    failure: 'Agent round',
  },
  {
    id: 'GOLD-SIX',
    prompt: 'Do I need all six Council agents for this?',
    expected_path: 'SHORT_PATH',
    expected_seats_max: 0,
    tool: 'NONE',
    authority: 'none',
    qualities: ['no always-six'],
    failure: 'Spawns six seats to answer',
  },
  {
    id: 'GOLD-FAIL',
    prompt: 'Why did that last research fail?',
    expected_path: 'SHORT_PATH',
    expected_seats_max: 0,
    tool: 'NONE',
    authority: 'none',
    qualities: ['natural failure language'],
    failure: 'Dumps TOOL_BLOCKED ids',
  },
]
