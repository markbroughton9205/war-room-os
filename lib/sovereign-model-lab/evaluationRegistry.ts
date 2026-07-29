/**
 * Static catalog of evaluation definitions. Phase 1 defines what would be measured — it does not
 * run any evaluation against a real model, since no War Room-trained model exists yet.
 */
import type { EvaluationDefinition, EvaluationKind } from './types'

export const EVALUATION_DEFINITIONS: readonly EvaluationDefinition[] = [
  { kind: 'language_modeling_loss', label: 'Language modeling loss', description: 'Held-out perplexity/cross-entropy loss on a reserved validation split.', measuresPolicyIndependenceNotDataAccess: false },
  { kind: 'memorization_check', label: 'Memorization check', description: 'Tests whether the model reproduces verbatim training-data sequences beyond expected overlap.', measuresPolicyIndependenceNotDataAccess: false },
  { kind: 'training_data_contamination_check', label: 'Training-data contamination check', description: 'Checks whether evaluation benchmark content leaked into the training corpus.', measuresPolicyIndependenceNotDataAccess: false },
  { kind: 'basic_reasoning', label: 'Basic reasoning', description: 'Simple multi-step reasoning and arithmetic/logic tasks.', measuresPolicyIndependenceNotDataAccess: false },
  { kind: 'factual_retrieval', label: 'Factual retrieval', description: 'Retrieval of facts the model was trained on, with source traceability where possible.', measuresPolicyIndependenceNotDataAccess: false },
  { kind: 'source_attribution', label: 'Source attribution', description: 'Whether the model can cite which admitted document(s) a claim plausibly derives from.', measuresPolicyIndependenceNotDataAccess: false },
  { kind: 'coding', label: 'Coding', description: 'Basic code generation and comprehension tasks.', measuresPolicyIndependenceNotDataAccess: false },
  { kind: 'tool_use_formatting', label: 'Tool-use formatting', description: 'Whether the model can emit correctly structured tool-call requests.', measuresPolicyIndependenceNotDataAccess: false },
  {
    kind: 'refusal_independent_topic_coverage',
    label: 'Refusal-independent topic coverage',
    description:
      'Measures whether the model can analyze lawful sensitive or controversial topics without a third-party provider\'s policy layer interfering with the analysis. This does NOT authorize access to private or illegal data — it evaluates reasoning on lawfully admitted training content only.',
    measuresPolicyIndependenceNotDataAccess: true,
  },
  { kind: 'privacy_leakage', label: 'Privacy leakage', description: 'Tests whether the model exposes personal data it should not retain or reveal.', measuresPolicyIndependenceNotDataAccess: false },
  { kind: 'prompt_injection_resistance', label: 'Prompt injection resistance', description: 'Tests resistance to instructions embedded in untrusted input overriding system intent.', measuresPolicyIndependenceNotDataAccess: false },
]

export function getEvaluationDefinition(kind: EvaluationKind): EvaluationDefinition | undefined {
  return EVALUATION_DEFINITIONS.find(d => d.kind === kind)
}
