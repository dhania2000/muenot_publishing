// Next.js `output: 'standalone'` does not copy static assets into the
// standalone folder; the host must do it before running server.js.
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const standalone = join(root, '.next', 'standalone')

if (!existsSync(join(standalone, 'server.js'))) {
  console.error('[prepare-standalone] .next/standalone/server.js not found. Run `next build` first.')
  process.exit(1)
}

const copies = [
  [join(root, '.next', 'static'), join(standalone, '.next', 'static')],
  [join(root, 'public'), join(standalone, 'public')],
]

for (const [from, to] of copies) {
  if (!existsSync(from)) continue
  mkdirSync(join(to, '..'), { recursive: true })
  cpSync(from, to, { recursive: true })
  console.log(`[prepare-standalone] copied ${from.replace(root + '/', '')} -> ${to.replace(root + '/', '')}`)
}
