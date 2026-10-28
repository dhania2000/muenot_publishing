"use client"
import type { GenerationEvidenceMetadata } from "@/lib/alt-text/description-evidence"
export function GenerationEvidenceSummary({ value }: { value?: GenerationEvidenceMetadata | null }) {
  if (!value) return null
  return <details className="rounded-md border p-3 text-sm">
    <summary className="cursor-pointer font-medium">Generation evidence · {value.strategy.replaceAll("_", " ")}</summary>
    <div className="mt-3 space-y-2">
      <p className="text-muted-foreground">Generated review candidate. Source transcription and scientific accuracy require separate review.</p>
      <p>{value.provider} · {value.outputLanguage} · <time dateTime={value.generatedAt}>{value.generatedAt}</time></p>
      <p>{value.occurrenceId == null ? "Standalone image" : `Document occurrence ${value.occurrenceId}`} · {value.evidence.length} saved evidence references</p>
      {value.terminology && <div className="space-y-1 rounded border p-2 text-xs"><p>Terminology policy: {value.terminology.policy.ruleVersion} · literal source preservation</p><p>Output language: {value.terminology.policy.outputLanguage} · Source language: unknown · Reviewer-edited language: not assessed</p><p>OCR modes used: {value.terminology.policy.ocrLanguageModes.join(", ")||"none in this generation"} · Document scripts: {value.terminology.policy.documentScripts.join(", ")||"unavailable"}</p><p>Subject: {value.terminology.policy.subject} · Audience: {value.terminology.policy.audience} · Reader level: {value.terminology.policy.grade}</p><p>No approved glossary or client guideline is available. Terminology warnings require human review; no automatic replacements or scientific verification.</p></div>}
      {value.documentContext && <div className="space-y-1 text-xs"><p>Document {value.documentContext.documentId} · occurrence {value.documentContext.occurrenceId} · context v{value.documentContext.contextVersion}</p><p className="break-all">Context snapshot: {value.documentContext.fingerprint}</p><ul>{value.documentContext.references.map(r=><li key={r.id}>{r.sourceKind} · {r.sourceRef ?? r.id}</li>)}</ul></div>}
      {value.evidence.length > 0 && <ul className="max-h-48 space-y-1 overflow-auto text-xs">{value.evidence.map(e => <li key={e.id}><span className="font-mono break-all">{e.id}</span> · v{e.version} · {e.kind.replaceAll("_", " ")} · {e.state.replaceAll("_", " ")}</li>)}</ul>}
      <p className="text-xs text-muted-foreground">{value.guidelineVersion == null ? "No approved client guideline was applied." : `Guideline version ${value.guidelineVersion}`}</p>
    </div>
  </details>
}
