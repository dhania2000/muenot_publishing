// Generates synthetic, properly licensed OCR fixtures (Phase 3 Task 6).
// Text is rendered with Noto Sans Devanagari (SIL OFL 1.1, test/fixtures/fonts/OFL.txt) through
// resvg (HarfBuzz-compatible shaping), so conjuncts and matras are shaped as a real document would.
// Ground truth is written to manifest.json with exact Unicode strings. Run:
//   node scripts/generate-ocr-multilingual-fixtures.mjs
import { Resvg } from "@resvg/resvg-js"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

const OUT = path.join(process.cwd(), "test/fixtures/ocr/multilingual")
const FONT = path.join(process.cwd(), "test/fixtures/fonts/NotoSansDevanagari.ttf")
mkdirSync(OUT, { recursive: true })

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** lines: string[] | columns: string[][]. Returns PNG bytes. */
function render({ lines, columns, size = 36, width = 1100, bold = false, scale = 1 }) {
  const lh = Math.round(size * 1.7)
  const cols = columns ?? [lines]
  const rows = Math.max(...cols.map((c) => c.length))
  const height = rows * lh + size * 2
  const colW = width / cols.length
  const texts = cols
    .flatMap((col, ci) =>
      col.map(
        (t, li) =>
          `<text x="${Math.round(ci * colW + size)}" y="${size + (li + 1) * lh - Math.round(lh * 0.3)}" font-size="${size}"${bold ? ` stroke="#000" stroke-width="${(size / 28).toFixed(2)}"` : ""}>${esc(t)}</text>`,
      ),
    )
    .join("")
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#fff"/><g font-family="Noto Sans Devanagari" fill="#000">${texts}</g></svg>`
  const r = new Resvg(svg, { fitTo: { mode: "zoom", value: scale }, font: { fontFiles: [FONT], loadSystemFonts: false, defaultFontFamily: "Noto Sans Devanagari" } })
  return r.render().asPng()
}

const HINDI = [
  "नमस्ते दुनिया",
  "हिंदी भाषा",
  "कक्षा दस",
  "विज्ञान की पुस्तक",
  "गणित के महत्वपूर्ण प्रश्न",
  "प्रकाश का परावर्तन",
  "न्यूटन का प्रथम नियम",
  "त्रिभुज का क्षेत्रफल",
  "कोशिका की संरचना",
  "विद्युत धारा",
  "प्रश्न संख्या १२",
  "शिक्षा और विकास",
]

const HINDI_FEATURES = [
  { id: "matras", text: "किताब दीपक गुलाब फूल मेला पैसा मोर कौआ" },
  { id: "nukta", text: "ज़मीन फ़ोन क़लम" },
  { id: "anusvara_chandrabindu", text: "संख्या हँसना चाँद" },
  { id: "visarga", text: "दुःख अतः" },
  { id: "virama_conjuncts", text: "क्षेत्र त्रिभुज ज्ञान श्रम प्रकाश क्रम स्तर विद्या" },
  { id: "danda_digits", text: "यह सही है। वर्ष २०२६ है॥" },
  { id: "ri_matra", text: "कृषि हृदय" },
]

const BILINGUAL = [
  "कक्षा 10 Science",
  "Chapter 5 — मानव शरीर",
  "Physics के महत्वपूर्ण प्रश्न",
  "Class 12 गणित",
  "Newton's First Law — न्यूटन का प्रथम नियम",
  "Human Heart — मानव हृदय",
  "Force = Mass × Acceleration",
  "Biology Chapter 3 — कोशिका",
  "Question No. 15 — सही उत्तर चुनिए",
  "NaCl — सोडियम क्लोराइड",
]

const manifest = []
const add = (id, category, mode, truth, png, extra = {}) => {
  const file = `${id}.png`
  writeFileSync(path.join(OUT, file), png)
  manifest.push({ id, file, category, mode, expected: truth, ...extra })
}

HINDI.forEach((t, i) => add(`hin-${String(i + 1).padStart(2, "0")}`, "clean_hindi", "hin", t, render({ lines: [t] })))
for (const f of HINDI_FEATURES) add(`hin-feature-${f.id}`, "hindi_features", "hin", f.text, render({ lines: [f.text] }))
BILINGUAL.forEach((t, i) => add(`bi-${String(i + 1).padStart(2, "0")}`, "mixed", "eng_hin", t, render({ lines: [t] })))

add("eng-clean", "clean_english", "eng", "The quick brown fox jumps over the lazy dog 123", render({ lines: ["The quick brown fox jumps over the lazy dog 123"] }))
add("hin-low-res", "low_resolution_hindi", "hin", "प्रकाश का परावर्तन", render({ lines: ["प्रकाश का परावर्तन"], size: 36, scale: 0.35 }))
add("hin-small-font", "small_font", "hin", "विज्ञान की पुस्तक", render({ lines: ["विज्ञान की पुस्तक"], size: 14, width: 400 }))
add("hin-bold-heading", "bold_heading", "hin", "अध्याय पाँच", render({ lines: ["अध्याय पाँच"], size: 48, bold: true }))
const para = ["प्रकाश एक प्रकार की ऊर्जा है।", "यह सीधी रेखा में चलता है।", "दर्पण प्रकाश को परावर्तित करता है।"]
add("hin-paragraph", "multi_line", "hin", para.join("\n"), render({ lines: para }))
const colA = ["भौतिक विज्ञान", "बल और गति", "ऊर्जा"]
const colB = ["Chemistry", "Atoms and Molecules", "Acids"]
add("bi-two-columns", "multi_column", "eng_hin", [...colA, ...colB].join("\n"), render({ columns: [colA, colB], width: 1200 }), { columns: [colA, colB] })
const sci = ["विद्युत धारा (Current)", "Sodium Chloride (NaCl)", "कोशिका झिल्ली", "Human Digestive System"]
add("bi-scientific", "scientific_labels", "eng_hin", sci.join("\n"), render({ lines: sci }))
add("num-punct", "numbers_punctuation", "eng_hin", "मूल्य: 3.14, -5; ०१२३४५६७८९ (सही?)", render({ lines: ["मूल्य: 3.14, -5; ०१२३४५६७८९ (सही?)"] }))

writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({ font: "Noto Sans Devanagari (SIL OFL 1.1)", renderer: "@resvg/resvg-js@2.6.2", samples: manifest }, null, 2) + "\n")
console.log(`wrote ${manifest.length} fixtures to ${path.relative(process.cwd(), OUT)}`)
