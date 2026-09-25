// Tiny, deterministic zero-exit fixture used by the Foundry broker-extension validation suite to
// prove terminal.execute/validation.run surface a real success. Does nothing else.
// (node --test at the repo root is NOT used for this: this repo carries a leftover
// desktop/node_modules.windows-bak/ backup tree whose bundled third-party test files use
// tape/describe and fail under node:test, which is real repo mess, not a broker bug — see
// engineerToolsBrokerExtension.validation.ts.)
process.exit(0)
