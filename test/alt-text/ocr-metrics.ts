/**
 * CER/WER for OCR fixtures (Phase 3 Task 6).
 *
 * Comparison policy (documented, applied identically to expected and recognised text):
 * - NFC normalisation (canonical only; no compatibility folding, no transliteration).
 * - All whitespace runs (including line breaks) collapse to one space; outer whitespace trimmed.
 * - Nothing else: case, punctuation, digits script and symbols must match exactly.
 * CER is computed over Unicode code points (so a missing matra or virama counts as an error),
 * WER over space-separated tokens. Both are Levenshtein distance / reference length.
 */
export const comparable = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim()

function levenshtein<T>(a: T[], b: T[]): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
    }
  }
  return prev[b.length]
}

export function errorRates(expected: string, actual: string) {
  const e = comparable(expected)
  const a = comparable(actual)
  const ec = Array.from(e)
  const ew = e ? e.split(" ") : []
  const charEdits = levenshtein(ec, Array.from(a))
  const wordEdits = levenshtein(ew, a ? a.split(" ") : [])
  return { cer: ec.length ? charEdits / ec.length : 0, wer: ew.length ? wordEdits / ew.length : 0, charEdits, refChars: ec.length, wordEdits, refWords: ew.length }
}
