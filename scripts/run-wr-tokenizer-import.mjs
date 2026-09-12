import { importWrTokenizer0 } from '../lib/wr-tokenizer/importArtifact.ts'
import { wrTokenizerStatusPayload } from '../lib/wr-tokenizer/status.ts'

const imported = await importWrTokenizer0({})
console.log(JSON.stringify({ imported, status: wrTokenizerStatusPayload() }, null, 2))
