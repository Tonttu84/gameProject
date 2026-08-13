#!/usr/bin/env node
// Regenerate docs/BALANCE_SHEET.md from the authored content.
//
//   npm --prefix campaign-server run balance-sheet     → writes the snapshot
//   node campaign-server/scripts/balanceSheet.js --stdout   → prints it instead
//
// The snapshot is committed so the numbers can be diffed in review and read
// on a machine that isn't set up to run node. It imports only pure modules —
// no DB, no engine binary — so it works in any environment.
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderMarkdown } from '../services/balanceSheet.js'

const markdown = `${renderMarkdown()}\n`

if (process.argv.includes('--stdout')) {
  process.stdout.write(markdown)
} else {
  const here = dirname(fileURLToPath(import.meta.url))
  const target = resolve(here, '../../docs/BALANCE_SHEET.md')
  writeFileSync(target, markdown)
  process.stderr.write(`wrote ${target}\n`)
}
