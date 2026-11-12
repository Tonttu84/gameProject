import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { DryMongoBinary } from 'mongodb-memory-server'
import { embeddedServerOptions } from '../utils/db.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// The embedded persistent mongod keeps the campaign DB in ~/.gameproject/db
// across restarts. A mongod opens only data files whose featureCompatibility
// version it supports: 8.2 refuses a 7.0 data dir outright (exit code 62), so
// letting mongodb-memory-server's default binary move a major (it went from
// 7.0 to 8.2 in v11) bricks every existing local campaign DB. The version
// must follow the server the rest of the stack runs, docker-compose's and
// CI's mongo image, and move only on purpose. DryMongoBinary.generateOptions
// is the resolution MongoMemoryServer itself runs, so this checks the
// version that would actually launch, without downloading or starting it.
describe('embedded mongod version', () => {
  test('runs the same server major as the docker-compose mongo image', async () => {
    const compose = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8')
    const composeMajor = compose.match(/image:\s*mongo:(\d+)/)?.[1]
    expect(composeMajor).toBeDefined()

    const { version } = await DryMongoBinary.generateOptions(embeddedServerOptions('unused').binary)
    expect(version.split('.')[0]).toBe(composeMajor)
  })

  // mongodb-memory-server's postinstall fetches the version named in this
  // package.json's config, else its own default. If the two differ, `npm ci`
  // fetches a binary nobody runs and the first test file downloads the real
  // one (~500 MB) inside its 30 s beforeAll, which fails on a fresh clone.
  test('is the version the install-time download fetches', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'campaign-server', 'package.json'), 'utf8'))
    expect(pkg.config?.mongodbMemoryServer?.version).toBe(
      embeddedServerOptions('unused').binary.version,
    )
  })
})
