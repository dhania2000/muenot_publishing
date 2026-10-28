import "server-only"
import { createHash } from "node:crypto"
import { query } from "@/lib/db"
import { currentTenantId } from "@/lib/tenant-scope"
import { getAsset, getLatestRegionAnalysis, getOccurrenceClassification, listOcrResults, occurrenceBelongsToAsset } from "./store"
import { toAnalysisView } from "./region-service"
import { toOcrView } from "./ocr-service"
import { readImageHeader } from "./image-header"
import { ensureEvidenceSchema } from "./math-store"
import { withinScope, type HistoryActor } from "./history"
import { boundDescriptionEvidence, descriptionStrategy, type DescriptionEvidence, type DescriptionEvidenceItem } from "./description-evidence"

const parsed = (value: any) => typeof value === "string" ? JSON.parse(value) : value
type Row = { id: number; version: number; kind: string; region_id: string; status: string; input_json: any; result_json: any }
/** Reads saved evidence only. Caller supplies the same private bytes being sent to generation. */
export async function loadDescriptionEvidence(assetId: number, occurrenceId: number | null, bytes: Uint8Array, actor: HistoryActor, allowedKinds?: readonly string[]): Promise<DescriptionEvidence> {
  const asset = await getAsset(assetId)
  if (!asset || !withinScope(actor.viewScope, actor.userId, asset) || !withinScope(actor.updateScope, actor.userId, asset) || occurrenceId != null && !await occurrenceBelongsToAsset(assetId, occurrenceId)) throw new Error("DESCRIPTION_SOURCE_FORBIDDEN")
  const occurrence = occurrenceId == null ? null : await getOccurrenceClassification(assetId, occurrenceId)
  const category = occurrence?.manual?.primaryCategory ?? asset.classificationRecord?.manual?.primaryCategory ?? asset.classificationRecord?.automated?.primaryCategory ?? asset.classification
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex")
  if (descriptionStrategy(category ?? null) === "standard") return { schemaVersion: 1, assetId, occurrenceId, sourceSha256, regionAnalysisId: null, classification: category ?? null, strategy: "standard", items: [], warnings: [], requiresReview: true, guidelineVersion: null }
  await ensureEvidenceSchema()
  const [stored, ocrRows, rows] = await Promise.all([
    getLatestRegionAnalysis(assetId, occurrenceId), listOcrResults(assetId, occurrenceId),
    query<Row[]>(`SELECT e.id,e.version,e.kind,e.region_id,e.status,e.input_json,e.result_json FROM alt_text_accessibility_evidence e
      WHERE e.tenant_id=? AND e.asset_id=? AND e.occurrence_key=?
      AND e.kind IN ('math_recognition','math_validation','ocr_review','chart_structure','chart_axes','chart_data','scientific_structure','scientific_domain','illustration_structure')
      AND NOT EXISTS (SELECT 1 FROM alt_text_accessibility_evidence n WHERE n.tenant_id=e.tenant_id AND n.asset_id=e.asset_id AND n.occurrence_key=e.occurrence_key AND n.kind=e.kind AND n.region_id=e.region_id AND n.version>e.version)
      ORDER BY e.id DESC LIMIT 200`, [currentTenantId(), assetId, occurrenceId ?? 0]),
  ])
  const analysis = stored ? toAnalysisView(stored) : null, header = readImageHeader(bytes, asset.mimeType)
  const frame = !!analysis && !!header && !header.orientationUnknown && header.orientation === 1 && analysis.source.orientation === 1 && !analysis.source.orientationUnknown && header.width === analysis.source.storedWidth && header.height === analysis.source.storedHeight
  const regionIds = new Set(frame ? analysis!.regions.map(r => r.id) : [])
  const result: DescriptionEvidence = { schemaVersion: 1, assetId, occurrenceId, sourceSha256, regionAnalysisId: frame ? analysis!.analysisId : null, classification: category ?? null, strategy: descriptionStrategy(category ?? null), items: [], warnings: [], requiresReview: true, guidelineVersion: null }
  const add = (id: string, version: number, kind: string, regionId: string | null, state: DescriptionEvidenceItem["state"], payload: unknown) => result.items.push({ id, version, kind, regionId, state, payload })
  const originals = new Map<string, { raw: string; regionId: string | null }>(), seenOcr = new Set<string>()
  for (const row of ocrRows) {
    const o = toOcrView(row), key = o?.region?.regionId ?? "full"
    if (!o || seenOcr.has(key)) continue
    seenOcr.add(key)
    if (o.assetId !== assetId || o.occurrenceId !== occurrenceId || o.inputSha256 !== sourceSha256 || !["completed", "completed_with_warnings"].includes(o.status) || !o.rawText || o.rawText.length > 8000 || o.region && (!frame || !regionIds.has(o.region.regionId) || o.region.analysisId !== analysis!.analysisId || o.region.analysisVersion !== analysis!.version)) continue
    originals.set(`image:${o.resultId}`, { raw: o.rawText, regionId: o.region?.regionId ?? null })
    add(`image:${o.resultId}`, o.version, "ocr", o.region?.regionId ?? null, "raw", { text: o.rawText, warnings: o.warnings, confidence: o.meanConfidence, confidenceScale: o.confidenceScale, readingOrderVerified: false })
  }
  const current = new Map<number, { row: Row; value: any }>()
  for (const row of rows) {
    if (allowedKinds && !allowedKinds.includes(row.kind === "math_recognition" ? "math" : row.kind)) continue
    const v = parsed(row.result_json)
    if (!v || !["candidate", "completed"].includes(row.status) || v.assetId !== assetId || v.occurrenceId !== occurrenceId || !frame || !regionIds.has(row.region_id)) continue
    const sha = v.source?.sourceSha256 ?? v.sourceSha256, aid = v.source?.analysisId ?? v.regionAnalysisId
    if (sha !== sourceSha256 || aid != null && aid !== analysis!.analysisId || v.source?.analysisVersion != null && v.source.analysisVersion !== analysis!.version) continue
    current.set(Number(row.id), { row, value: v })
  }
  for (const { row, value: v } of current.values()) {
    if (row.kind === "math_recognition" && typeof v.candidateLatex === "string") {
      originals.set(`math:${row.id}`, { raw: v.rawOutput, regionId: row.region_id })
      const validation = rows.find(r => r.kind === "math_validation" && parsed(r.result_json)?.sourceEvidenceId === Number(row.id) && parsed(r.result_json)?.originalCandidate === v.candidateLatex)
      add(`math:${row.id}`, row.version, "math", row.region_id, "candidate", { latex: v.candidateLatex, syntaxStatus: validation ? parsed(validation.result_json).syntaxStatus : "not_validated", validationId: validation ? Number(validation.id) : null, scientificAccuracyVerified: false, warnings: v.warnings })
      if (validation) add(`validation:${validation.id}`, validation.version, "math_validation", row.region_id, "candidate", { sourceRef: `math:${row.id}`, syntaxStatus: parsed(validation.result_json).syntaxStatus, scientificAccuracyVerified: false })
    }
  }
  for (const row of rows.filter(r => r.kind === "ocr_review")) {
    const input = parsed(row.input_json), v = parsed(row.result_json), original = originals.get(input?.sourceRef)
    if (!original || !v || input.target?.assetId !== assetId || input.target?.occurrenceId !== occurrenceId || v.originalText !== original.raw) continue
    add(`review:${row.id}`, row.version, "ocr_review", original.regionId, v.state === "verified" ? "transcription_verified" : v.state === "corrected" ? "corrected" : "candidate", { sourceRef: input.sourceRef, reviewState: v.state, correctedText: ["corrected", "verified"].includes(v.state) ? v.correctedText : null, syntaxStatus: v.validation?.syntaxStatus ?? null, scientificAccuracyVerified: false })
  }
  for (const { row, value: v } of current.values()) {
    let payload: unknown
    if (row.kind === "chart_structure") payload = { output: v.output, sourceMatchVerified: false }
    else if (row.kind === "chart_axes") {
      const parent = current.get(v.parentChartEvidenceId)
      if (!parent || parent.row.version !== v.parentChartVersion) continue
      const { authorizedChartDataParent, assertChartDataCurrent } = await import("./chart-data-service")
      const { AdvancedEvidenceError } = await import("./advanced-evidence-source")
      try { const source = await authorizedChartDataParent(assetId, occurrenceId, Number(row.id), actor); await assertChartDataCurrent(source.parent, actor, false) }
      catch (error) { if (error instanceof AdvancedEvidenceError) { result.warnings.push("Saved chart labels or geometry are stale and were omitted."); continue }; throw error }
      // Saved labels/geometry are candidates; only a live chart data review can authorize values.
      payload = { axes: v.axes, labels: v.labels, legends: v.legends, titles: v.titles, positionsAreEstimates: true, usableForPixelExtraction: false }
    } else if (row.kind === "chart_data") {
      const { reviewedChartData } = await import("./chart-data-review")
      const { AdvancedEvidenceError } = await import("./advanced-evidence-source")
      let reviewed
      try { reviewed = await reviewedChartData(assetId, occurrenceId, Number(row.id), actor) }
      catch (error) { if (error instanceof AdvancedEvidenceError) { result.warnings.push("Saved chart values could not be validated and were omitted."); continue }; throw error }
      if (!reviewed.sourceCurrent) continue
      payload = { points: reviewed.result.points.filter(p => p.classification === "label_exact" && p.reviewState === "confirmed_label" && p.value != null), trends: reviewed.result.trends, datasetApproved: false, warnings: reviewed.result.warnings }
      for (const decision of reviewed.decisions ?? []) add(`chart-review:${decision.id}`, decision.version, "chart_data_review", row.region_id, "candidate", { sourceRef: `evidence:${row.id}`, sourceEvidenceId: Number(row.id), sourceLabelId: decision.sourceLabelId, state: decision.state })
    } else if (row.kind === "scientific_structure") payload = { elements: v.elements.map(({ sourceText, ...e }: any) => e), relationships: v.relationships, labelAssociations: v.labelAssociations, scientificAccuracyVerified: false }
    else if (row.kind === "scientific_domain") {
      const parent = current.get(v.parentStructureEvidenceId)
      if (!parent || parent.row.version !== v.parentStructureVersion) continue
      // No saved document context or domain inference may leak through an asset-level generation.
      payload = { detectedSubjects: v.detectedSubjects, observations: v.observations.filter((o: any) => o.basis === "direct_visual_candidate").map(({ sourceLabels, ...o }: any) => o), scientificAccuracyVerified: false }
    } else if (row.kind === "illustration_structure") {
      if (["flowchart", "table", "map"].includes(result.strategy) && v.contentType !== result.strategy) continue
      payload = { contentType: v.contentType, output: v.output, elements: v.elements.map(({ sourceText, ocrOrder, ...e }: any) => e), structureVerified: false, readingOrderVerified: false }
    }
    else continue
    add(`evidence:${row.id}`, row.version, row.kind, row.region_id, "candidate", payload)
  }
  if (frame) add(`regions:${analysis!.analysisId}`, analysis!.version, "regions", null, "candidate", { regions: analysis!.regions.map(r => ({ id: r.id, parentId: r.parentId, type: r.primaryType, box: r.box })), relationships: analysis!.relationships, positionsAreEstimates: true, readingOrderVerified: false })
  result.warnings.push("Saved recognition and structure may contain errors. Verified transcription does not approve the description or establish scientific accuracy.")
  if (allowedKinds) result.items = result.items.filter(item => allowedKinds.includes(item.kind))
  return boundDescriptionEvidence(result)
}
