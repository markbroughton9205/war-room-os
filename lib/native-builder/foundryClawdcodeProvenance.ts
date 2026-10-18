/**
 * Provenance for Foundry's ClawdCode open-source embedding.
 * Source is MIT-licensed. Foundry does not vendor the upstream tree and does not
 * spawn an external `clawdcode` process.
 */
export const CLAWDCODE_UPSTREAM = {
  repoUrl: 'https://github.com/kkkhs/ClawdCode',
  cloneUrl: 'https://github.com/kkkhs/ClawdCode.git',
  owner: 'kkkhs',
  name: 'ClawdCode',
  packageName: 'clawdcode',
  version: '1.8.0',
  commit: '217a01369f9cb7d1ccc89c1fd9f50d6db2965b81',
  license: 'MIT',
  spdx: 'MIT',
  copyright: 'Copyright (c) 2026',
  author: 'kkkhs',
  licenseUrl: 'https://github.com/kkkhs/ClawdCode/blob/217a01369f9cb7d1ccc89c1fd9f50d6db2965b81/LICENSE',
  researchCloneExample: '~/.local/share/war-room-os/research/clawdcode/',
} as const

export const CLAWDCODE_ATTRIBUTION_NOTICE = [
  'Portions of Foundry agent-loop, context, skill-import, and event mechanisms',
  'are adapted from ClawdCode (https://github.com/kkkhs/ClawdCode),',
  `${CLAWDCODE_UPSTREAM.copyright}. Licensed under the MIT License.`,
  'The MIT copyright notice and permission notice are preserved in docs/third-party/clawdcode.md.',
].join(' ')

export const CLAWDCODE_EMBEDDING_FLAGS = {
  CLAWDCODE_EMBEDDED: true,
  EXTERNAL_CLAWDCODE_RUNTIME: false,
  UPSTREAM_RUNTIME_DEPENDENCY: false,
  MIT_ATTRIBUTION_PRESERVED: true,
  FOUNDRY_TOOL_BROKER_PRESERVED: true,
  FOUNDRY_AUTHORITY_MODEL_PRESERVED: true,
  FOUNDRY_PROVIDER_ARCHITECTURE_PRESERVED: true,
} as const

export const CLAWDCODE_RESEARCH_CLONE_PATH = process.env.HOME
  ? `${process.env.HOME}/.local/share/war-room-os/research/clawdcode`
  : ''
