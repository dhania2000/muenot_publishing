import { readFileSync } from "node:fs"
import path from "node:path"
import { it } from "vitest"
import { createWorker, OEM, PSM } from "tesseract.js"
import { errorRates } from "./ocr-metrics"

const dir = path.join(process.cwd(), "test/fixtures/ocr/multilingual")
const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")).samples as { id: string; file: string; mode: string; expected: string; category: string }[]
const pack = (c: string) => ({ code: c, data: new Uint8Array(readFileSync(path.join(process.cwd(), `node_modules/@tesseract.js-data/${c}/4.0.0_best_int/${c}.traineddata.gz`))) })

it("compare orders and psm", async () => {
  for (const order of [["hin", "eng"], ["eng", "hin"]]) {
    const w = await createWorker(order.map(pack), OEM.LSTM_ONLY, { cacheMethod: "none", errorHandler: () => undefined })
    await w.setParameters({ preserve_interword_spaces: "1", tessedit_pageseg_mode: PSM.AUTO })
    let edits = 0, ref = 0
    for (const s of manifest.filter((m) => m.mode === "eng_hin")) {
      const t0 = Date.now()
      const r = await w.recognize(readFileSync(path.join(dir, s.file)))
      const e = errorRates(s.expected, r.data.text)
      edits += e.charEdits; ref += e.refChars
      console.log(order.join("+"), s.id, e.cer.toFixed(3), Date.now() - t0, JSON.stringify(r.data.text.trim()))
    }
    console.log("TOTAL", order.join("+"), (edits / ref).toFixed(4))
    await w.terminate()
  }
}, 600_000)
