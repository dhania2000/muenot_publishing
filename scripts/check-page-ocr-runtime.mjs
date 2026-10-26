/** Offline deployment smoke: node scripts/check-page-ocr-runtime.mjs .next/standalone synthetic.pdf eng_hin
 * Uses the packaged runtime dependencies, not the repository's node_modules. No database or network.
 * Feed safe synthetic PDFs only. Full recognized text is deliberately not logged. */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { readFile, mkdtemp, writeFile, rm, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = path.resolve(process.argv[2] || '.next/standalone')
const source = process.argv[3]
const modes = { eng: ['eng'], hin: ['hin'], eng_hin: ['hin', 'eng'] }
const mode = process.argv[4] || 'eng'
if (!source || !Object.hasOwn(modes, mode)) throw new Error('Specify a synthetic PDF and eng, hin or eng_hin.')
if ((await stat(source)).size > 50 * 1024 * 1024) throw new Error('Smoke PDF is too large.')
const require = createRequire(path.join(root, 'package.json'))
const { createCanvas } = require('@napi-rs/canvas')
const pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href)
const { createWorker, OEM } = require('tesseract.js')
const hashes = { eng: '45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91', hin: 'f3b6a0d320df38d886178cdd727b90dbf9df3db053adb32bd9cf73f0463cda07' }
const tempRoot = path.resolve(tmpdir())
const dir = await mkdtemp(path.join(tempRoot, 'muenot-ocr-smoke-'))
let doc, worker
try {
  for (const code of modes[mode]) {
    const bytes = await readFile(path.join(root, 'node_modules', '@tesseract.js-data', code, '4.0.0_best_int', `${code}.traineddata.gz`))
    if (createHash('sha256').update(bytes).digest('hex') !== hashes[code]) throw new Error(`Invalid ${code} language pack.`)
    await writeFile(path.join(dir, `${code}.traineddata.gz`), bytes, { mode: 0o600 })
  }
  doc = await pdfjs.getDocument({ data: new Uint8Array(await readFile(source)), enableXfa: false, disableFontFace: true, useSystemFonts: false, useWorkerFetch: false, maxImageSize: 25_000_000, verbosity: 0 }).promise
  const page = await doc.getPage(1), viewport = page.getViewport({ scale: 200 / 72 })
  const width = Math.ceil(viewport.width), height = Math.ceil(viewport.height)
  if (width * height > 25_000_000 || width > 10_000 || height > 10_000) throw new Error('Smoke page exceeds raster limits.')
  const canvas = createCanvas(width, height)
  await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise
  const image = await canvas.encode('png')
  worker = await createWorker(modes[mode].join('+'), OEM.LSTM_ONLY, { langPath: dir, cacheMethod: 'none', errorHandler: () => {} })
  const { data } = await worker.recognize(image)
  if (!data.text.trim()) throw new Error('No text detected in the synthetic smoke PDF.')
  console.log(JSON.stringify({ node: process.version, platform: process.platform, pdfjs: pdfjs.version, pages: doc.numPages, raster: { width, height }, languages: modes[mode].join('+'), recognizedCharacters: data.text.length }))
} finally {
  await worker?.terminate()
  await doc?.destroy()
  if (path.dirname(path.resolve(dir)) !== tempRoot) throw new Error('Invalid temporary directory.')
  await rm(dir, { recursive: true, force: true })
}
