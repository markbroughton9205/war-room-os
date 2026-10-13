// Fixture "toolchain" probe: prints the version stored next to it (tests change the file to simulate a toolchain change).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
console.log(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'tool-version.txt'), 'utf8').trim())
