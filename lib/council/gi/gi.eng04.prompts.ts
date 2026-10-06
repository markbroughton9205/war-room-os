export type GiEng04QualityPrompt = {
  id: string
  category: 'conversation' | 'explanation' | 'architecture' | 'ai_concept' | 'reasoning' | 'writing' | 'follow_up' | 'planning' | 'ambiguity'
  prompt: string
  prior?: string[]
  expected_path: 'SHORT_PATH' | 'AGENT_PATH' | 'HANDOFF'
  must?: RegExp[]
  must_not?: RegExp[]
}

/** Installed intelligence quality set. Not encoded as one classifier regex per prompt. */
export const GI_ENG_04_QUALITY_PROMPTS: GiEng04QualityPrompt[] = [
  { id: 'Q-01', category: 'conversation', prompt: 'Hi Council', expected_path: 'SHORT_PATH' },
  { id: 'Q-02', category: 'conversation', prompt: 'Morning. Got a minute?', expected_path: 'SHORT_PATH' },
  { id: 'Q-03', category: 'conversation', prompt: 'Thanks. That helps.', expected_path: 'SHORT_PATH' },
  { id: 'Q-04', category: 'explanation', prompt: "What's the difference between RAM and VRAM?", expected_path: 'SHORT_PATH', must: [/ram|memory/i, /vram|gpu/i] },
  { id: 'Q-05', category: 'explanation', prompt: 'What is HTTP?', expected_path: 'SHORT_PATH', must: [/hypertext|protocol|request/i] },
  { id: 'Q-06', category: 'explanation', prompt: 'Explain TCP vs UDP like I ship browsers.', expected_path: 'SHORT_PATH' },
  { id: 'Q-07', category: 'architecture', prompt: 'Give me three architectural reasons not to put full Cesium on the Home page.', expected_path: 'SHORT_PATH' },
  { id: 'Q-08', category: 'architecture', prompt: 'Why should SHORT_PATH not spawn six Council seats?', expected_path: 'SHORT_PATH' },
  { id: 'Q-09', category: 'architecture', prompt: 'Explain what PathClassifier does.', expected_path: 'SHORT_PATH' },
  { id: 'Q-10', category: 'architecture', prompt: 'Walk through why Browser Broker should stay separate from Divine Council mutation.', expected_path: 'SHORT_PATH' },
  {
    id: 'Q-11',
    category: 'ai_concept',
    prompt: 'What are sparse experts in mixture-of-experts AI models?',
    expected_path: 'SHORT_PATH',
    must: [/mixture|moe|subnetwork|parameter|rout/i],
    must_not: [/human specialist|staffing|personnel|hire experts/i],
  },
  { id: 'Q-12', category: 'ai_concept', prompt: 'How could sparse expert routing help WRIM on Nebula?', expected_path: 'SHORT_PATH' },
  { id: 'Q-13', category: 'ai_concept', prompt: 'Why might a smaller model with better tools outperform a larger model without tools?', expected_path: 'SHORT_PATH' },
  { id: 'Q-14', category: 'ai_concept', prompt: 'What is the difference between a context window and RAM?', expected_path: 'SHORT_PATH' },
  { id: 'Q-15', category: 'reasoning', prompt: 'If a model needs 12 GB VRAM and another process reserves 5 GB on a 16 GB GPU, can both safely fit at once? Explain the practical problem.', expected_path: 'SHORT_PATH' },
  { id: 'Q-16', category: 'reasoning', prompt: 'Why does War Room still need RAM if inference is remote?', expected_path: 'SHORT_PATH' },
  { id: 'Q-17', category: 'writing', prompt: 'Rewrite this professionally:\nwe need to stop piling features on before we know the council is actually smart', expected_path: 'SHORT_PATH' },
  { id: 'Q-18', category: 'writing', prompt: 'Make that tighter.', prior: ['Rewrite this professionally: we need to stop piling features on'], expected_path: 'SHORT_PATH' },
  { id: 'Q-19', category: 'writing', prompt: 'Draft a Commander-facing note that a probe failed without dumping tool IDs.', expected_path: 'SHORT_PATH' },
  { id: 'Q-20', category: 'follow_up', prompt: 'Why is that the better order?', prior: ['I want to make the Council smarter before I redesign the UI.'], expected_path: 'SHORT_PATH' },
  { id: 'Q-21', category: 'follow_up', prompt: 'Explain it using War Room as the example.', prior: ["What's the difference between RAM and VRAM?"], expected_path: 'SHORT_PATH' },
  { id: 'Q-22', category: 'follow_up', prompt: 'Tell me more', prior: ['Sparse experts are neural-network submodules selected per token.'], expected_path: 'SHORT_PATH' },
  { id: 'Q-23', category: 'planning', prompt: 'Help me plan a two-hour debugging session for Browser Broker screenshots.', expected_path: 'SHORT_PATH' },
  { id: 'Q-24', category: 'planning', prompt: 'Brainstorm three ways to make Council answers feel less robotic.', expected_path: 'SHORT_PATH' },
  { id: 'Q-25', category: 'planning', prompt: 'What should I do first if I want smarter answers before a UI redesign?', expected_path: 'SHORT_PATH' },
  { id: 'Q-26', category: 'ambiguity', prompt: 'research?', expected_path: 'SHORT_PATH' },
  { id: 'Q-27', category: 'ambiguity', prompt: 'Can you look at this idea?', expected_path: 'SHORT_PATH' },
  { id: 'Q-28', category: 'ambiguity', prompt: 'check this out', prior: ['I sketched a thinner Council assembly.'], expected_path: 'SHORT_PATH' },
  { id: 'Q-29', category: 'architecture', prompt: 'What would break if Home imported Cesium at boot?', expected_path: 'SHORT_PATH' },
  { id: 'Q-30', category: 'explanation', prompt: 'What does the Browser Broker do like I am new to it?', expected_path: 'SHORT_PATH' },
]
