/**
 * @file lib/alt-text/history.ts
 * @module Publishing · Alt Text
 * @kind Server-side library
 * @summary Task 15: history list, single-asset read, manual edit and version history over the tenant-scoped store.
 * @usedBy app/api/alt-text/assets/route.ts, app/api/alt-text/assets/[id]/route.ts, app/api/alt-text/assets/[id]/versions/route.ts
 *
 * Permissions: reads need `publishing.alt_text:view` record scope; edits additionally need
 * `publishing.alt_text:update` record scope (review/approve never imply editing).
 * A record outside the caller's view scope is reported as 404 so its existence is not disclosed.
 */
import "server-only"
import type { PermissionScope } from "@/lib/permission-model"
import { ASSET_STATUSES, COMPLEX_CLASSIFICATIONS, IMAGE_CLASSIFICATIONS,normalizeGenerationSettings,validateGenerationSettings, type ImageClassification } from "./core"
import {ClientProfileError,resolveSelectedClientGuideline} from "./client-guideline-profile-store"
import {guidelineWarningsForPolicy} from "./client-guideline"
import { editAsset, getAsset, getSettings, listAssets, listVersions, type AssetRow } from "./store"
import { terminologyIssues,TERMINOLOGY_RULE_VERSION } from "./terminology-policy"

export type HistoryActor = { userId: number; viewScope: PermissionScope; updateScope?: PermissionScope;exportScope?:PermissionScope;approveScope?:PermissionScope }
export type HistoryFailure = { ok: false; status: number; code: string; error: string; details?: Record<string, unknown> }
type Ok<T> = { ok: true; body: T }

export type AltTextAssetView = {
  clientGuidelineId?:string|null
  clientGuidelineVersion?:number|null
  id: number
  fileName: string
  mimeType: string
  sizeBytes: number
  projectId: number | null
  projectName: string | null
  imageUrl: string
  classification: string | null
  status: string
  shortAlt: string | null
  longDescription: string | null
  extractedText: string | null
  warnings: string[]
  treatment: string | null
  language: string
  modelId: string | null
  reviewerName: string | null
  approvedAt: string | null
  currentVersion: number
  createdAt: string
  updatedAt: string
}

export type AltTextAssetList = { success: true; items: AltTextAssetView[]; total: number; page: number; pageSize: number }
export type AltTextAssetResponse = { success: true; asset: AltTextAssetView }
export type AltTextVersionView = {
  generationEvidence?: import("./description-evidence").GenerationEvidenceMetadata | null
  version: number
  changeType: string
  classification: string | null
  shortAlt: string | null
  longDescription: string | null
  note: string | null
  modelId: string | null
  editor: { id: number; name: string } | null
  createdAt: string
}
export type AltTextVersionList = { success: true; assetId: number; versions: AltTextVersionView[] }

export const EDIT_LIMITS = { shortAlt: 1000, longDescription: 20_000, extractedText: 20_000 } as const
const MAX_SEARCH = 200
const MAX_PAGE_SIZE = 100
const EDIT_KEYS = new Set(["shortAlt", "longDescription", "classification", "extractedText", "expectedVersion", "outputLanguage","clientGuidelineId","clientGuidelineVersion"])

const fail = (status: number, code: string, error: string, details?: Record<string, unknown>): HistoryFailure => ({
  ok: false,
  status,
  code,
  error,
  ...(details ? { details } : {}),
})
const NOT_FOUND = () => fail(404, "NOT_FOUND", "Asset not found.")

const DB_UNAVAILABLE_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "PROTOCOL_CONNECTION_LOST", "ER_CON_COUNT_ERROR", "POOL_CLOSED"])

/** Maps an unexpected error to a safe 503/500 without leaking SQL, stack or credentials. */
export function storeErrorToFailure(err: unknown): HistoryFailure {
  const code = (err as { code?: unknown } | null)?.code
  if (typeof code === "string" && DB_UNAVAILABLE_CODES.has(code)) return fail(503, "DATABASE_UNAVAILABLE", "The database is temporarily unavailable. Please try again.")
  return fail(500, "INTERNAL_ERROR", "Something went wrong. Please try again.")
}

export function parseAssetId(raw: string): number | null {
  if (!/^\d{1,15}$/.test(raw)) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export function withinScope(scope: PermissionScope | undefined, userId: number, asset: { createdBy: number; reviewerId: number | null }) {
  if (scope === "all") return true
  const added = asset.createdBy === userId
  const owned = asset.reviewerId === userId
  if (scope === "added") return added
  if (scope === "owned") return owned
  if (scope === "both") return added || owned
  return false
}

export function toAssetView(a: AssetRow): AltTextAssetView {
  return {
    clientGuidelineId:a.settingsOverride?.clientGuidelineId??null,
    clientGuidelineVersion:a.settingsOverride?.clientGuidelineVersion??null,
    id: a.id,
    fileName: a.fileName,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    projectId: a.projectId,
    projectName: a.projectName,
    imageUrl: a.imageUrl,
    classification: a.classification,
    status: a.status,
    shortAlt: a.shortAlt,
    longDescription: a.longDescription,
    extractedText: a.extractedText,
    warnings: a.warnings,
    treatment: a.treatment,
    language: a.language,
    modelId: a.modelId,
    reviewerName: a.reviewerName,
    approvedAt: a.approvedAt,
    currentVersion: a.currentVersion,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

export type ListQuery = { page: number; pageSize: number; search?: string; status?: string; classification?: string; sort: "newest" | "oldest" }

export function parseListQuery(sp: URLSearchParams): { ok: true; value: ListQuery } | HistoryFailure {
  const int = (key: string, def: number) => {
    const v = sp.get(key)
    if (v == null || v === "") return def
    return /^\d{1,6}$/.test(v) ? Number(v) : NaN
  }
  const page = int("page", 1)
  const pageSize = int("pageSize", 25)
  if (!(page >= 1)) return fail(400, "INVALID_QUERY", "page must be a positive integer.")
  if (!(pageSize >= 1 && pageSize <= MAX_PAGE_SIZE)) return fail(400, "INVALID_QUERY", `pageSize must be between 1 and ${MAX_PAGE_SIZE}.`)
  const search = sp.get("search")?.trim() || undefined
  if (search && search.length > MAX_SEARCH) return fail(400, "INVALID_QUERY", `search must be at most ${MAX_SEARCH} characters.`)
  const status = sp.get("status") || undefined
  if (status && !(ASSET_STATUSES as readonly string[]).includes(status)) return fail(400, "INVALID_QUERY", "Unknown status filter.")
  const classification = sp.get("classification") || undefined
  if (classification && !(IMAGE_CLASSIFICATIONS as readonly string[]).includes(classification)) return fail(400, "INVALID_QUERY", "Unknown classification filter.")
  const sort = sp.get("sort") || "newest"
  if (sort !== "newest" && sort !== "oldest") return fail(400, "INVALID_QUERY", "sort must be 'newest' or 'oldest'.")
  return { ok: true, value: { page, pageSize, search, status, classification, sort } }
}

export async function listHistory(q: ListQuery, actor: HistoryActor): Promise<Ok<AltTextAssetList> | HistoryFailure> {
  const scopeFilter =
    actor.viewScope === "all"
      ? {}
      : actor.viewScope === "added"
        ? { createdById: actor.userId }
        : actor.viewScope === "owned"
          ? { reviewerUserId: actor.userId }
          : actor.viewScope === "both"
            ? { ownerId: actor.userId }
            : null
  if (!scopeFilter) return fail(403, "FORBIDDEN", "You do not have permission to view alt text.")
  const { items, total } = await listAssets({
    ...scopeFilter,
    search: q.search ? escapeLike(q.search) : undefined,
    status: q.status,
    classification: q.classification,
    sort: q.sort,
    limit: q.pageSize,
    offset: (q.page - 1) * q.pageSize,
  })
  return { ok: true, body: { success: true, items: items.map(toAssetView), total, page: q.page, pageSize: q.pageSize } }
}

async function visibleAsset(id: number, actor: HistoryActor) {
  const asset = await getAsset(id)
  return asset && withinScope(actor.viewScope, actor.userId, asset) ? asset : null
}

export async function readAsset(id: number, actor: HistoryActor): Promise<Ok<AltTextAssetResponse> | HistoryFailure> {
  const asset = await visibleAsset(id, actor)
  if (!asset) return NOT_FOUND()
  return { ok: true, body: { success: true, asset: toAssetView(asset) } }
}

export async function readVersions(id: number, actor: HistoryActor): Promise<Ok<AltTextVersionList> | HistoryFailure> {
  const asset = await visibleAsset(id, actor)
  if (!asset) return NOT_FOUND()
  const versions = await listVersions(id)
  return {
    ok: true,
    body: {
      success: true,
      assetId: id,
      versions: versions.map((v) => ({
        version: v.version,
        changeType: v.action,
        classification: v.classification,
        shortAlt: v.shortAlt,
        longDescription: v.longDescription,
        note: v.note,
        modelId: v.modelId,
        generationEvidence: v.generationEvidence,
        editor: v.actorId ? { id: v.actorId, name: v.actorName } : null,
        createdAt: v.createdAt,
      })),
    },
  }
}

/** Unicode-preserving normalisation: NFC, line endings unified, C0/C1 controls (except \n and \t) removed, trimmed. */
export function cleanText(s: string): string {
  return s
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .trim()
}

export type EditRequest = {
  clientGuidelineId?:string|null
  clientGuidelineVersion?:number|null
  outputLanguage?: "en" | "hi"
  expectedVersion: number
  shortAlt?: string
  longDescription?: string
  classification?: ImageClassification
  extractedText?: string
}

export function parseEditRequest(body: unknown): { ok: true; value: EditRequest } | HistoryFailure {
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400, "INVALID_REQUEST", "Send a JSON object.")
  const b = body as Record<string, unknown>
  const extra = Object.keys(b).filter((k) => !EDIT_KEYS.has(k))
  if (extra.length) return fail(400, "INVALID_REQUEST", "Unexpected fields in request.", { fields: extra })
  if (typeof b.expectedVersion !== "number" || !Number.isSafeInteger(b.expectedVersion) || b.expectedVersion < 0) {
    return fail(400, "EXPECTED_VERSION_REQUIRED", "expectedVersion (the version you loaded) is required.")
  }
  const value: EditRequest = { expectedVersion: b.expectedVersion }
  if(b.clientGuidelineId!==undefined||b.clientGuidelineVersion!==undefined){const selection=normalizeGenerationSettings(b),errors=validateGenerationSettings(selection);if(errors.clientGuidelineId||errors.clientGuidelineVersion)return fail(400,"INVALID_CLIENT_GUIDELINE","Choose a saved client guideline and version together.");value.clientGuidelineId=selection.clientGuidelineId;value.clientGuidelineVersion=selection.clientGuidelineVersion}
  if(b.outputLanguage!==undefined){if(b.outputLanguage!=="en"&&b.outputLanguage!=="hi")return fail(422,"UNSUPPORTED_LANGUAGE","Alt Text output currently supports English and Hindi only.");value.outputLanguage=b.outputLanguage}
  for (const key of ["shortAlt", "longDescription", "extractedText"] as const) {
    if (b[key] === undefined) continue
    if (typeof b[key] !== "string") return fail(400, "INVALID_REQUEST", `${key} must be a string.`, { field: key })
    if (!(b[key] as string).isWellFormed()) return fail(422,"INVALID_UNICODE",`${key} contains malformed Unicode; paste the original text again.`,{field:key})
    const text = cleanText(b[key] as string)
    if (text.length > EDIT_LIMITS[key]) return fail(422, "FIELD_TOO_LONG", `${key} must be at most ${EDIT_LIMITS[key]} characters.`, { field: key })
    value[key] = text
  }
  if (b.classification !== undefined) {
    if (typeof b.classification !== "string" || !(IMAGE_CLASSIFICATIONS as readonly string[]).includes(b.classification)) {
      return fail(422, "INVALID_CLASSIFICATION", "Unknown image classification.", { field: "classification" })
    }
    value.classification = b.classification as ImageClassification
  }
  if (value.shortAlt === undefined && value.longDescription === undefined && value.classification === undefined && value.extractedText === undefined && value.outputLanguage === undefined&&value.clientGuidelineId===undefined) {
    return fail(400, "NO_CHANGES", "Provide at least one field to update.")
  }
  return { ok: true, value }
}

export async function updateAsset(id: number, req: EditRequest, actor: HistoryActor): Promise<Ok<AltTextAssetResponse> | HistoryFailure> {
  const current = await visibleAsset(id, actor)
  if (!current) return NOT_FOUND()
  if (!withinScope(actor.updateScope, actor.userId, current)) return fail(403, "FORBIDDEN", "You do not have permission to edit this alt text.")

  const classification = req.classification ?? (current.classification as ImageClassification | null) ?? "other"
  const shortAlt = req.shortAlt ?? current.shortAlt ?? ""
  const longDescription = req.longDescription ?? current.longDescription ?? ""
  const extractedText = req.extractedText ?? current.extractedText ?? ""
  const decorative = classification === "decorative"

  if (!decorative && !shortAlt) {
    return fail(422, "ALT_TEXT_REQUIRED", "Short Alt Text is required for informative images. Mark the image decorative to leave it empty.", { field: "shortAlt" })
  }
  if (!decorative && COMPLEX_CLASSIFICATIONS.includes(classification) && !longDescription) {
    return fail(422, "DESCRIPTION_REQUIRED", "A Detailed Description is required for complex images.", { field: "longDescription" })
  }
  const { shortMaxChars } = await getSettings()
  const language=req.outputLanguage??(current.language==="hi"?"hi":"en")
  const notices=terminologyIssues(`${shortAlt}\n${longDescription}`,language).map(i=>`Terminology review (${i.code}): ${i.message}`)
  if(shortAlt.length>shortMaxChars)notices.push(`Short Alt Text exceeds the ${shortMaxChars}-character editorial target. Essential labels and notation were retained; this target is not a WCAG limit.`)

  let selectedClient:Awaited<ReturnType<typeof resolveSelectedClientGuideline>>|undefined
  if(req.clientGuidelineId!==undefined){try{selectedClient=await resolveSelectedClientGuideline(req)}catch(e){return e instanceof ClientProfileError?fail(e.status,e.code,e.message):fail(503,"CLIENT_GUIDELINE_UNAVAILABLE","Client guidelines could not be read; no edit was saved.")}}
  const previousWarnings=selectedClient===undefined?current.warnings:current.warnings.filter(w=>!w.startsWith("Client guideline "))
  const policyWarnings=selectedClient===undefined?[]:guidelineWarningsForPolicy(selectedClient,shortAlt,longDescription,decorative)
  const saved = await editAsset(id, { classification, shortAlt, longDescription, extractedText }, actor.userId, req.expectedVersion,{language,warnings:[...new Set([...previousWarnings,...notices,...policyWarnings])],note:`Terminology ${TERMINOLOGY_RULE_VERSION}; output ${language}; client ${selectedClient===undefined?"selection retained":selectedClient?`${selectedClient.id} v${selectedClient.version}`:"none"}; reviewer-edited language not assessed.`,...selectedClient!==undefined?{clientGuideline:selectedClient}:{}})
  if (saved === null) return NOT_FOUND()
  if (saved === "busy") return fail(409, "ASSET_BUSY", "This image is being generated. Try again when generation finishes.")
  if (saved === "conflict") {
    return fail(409, "VERSION_CONFLICT", "This alt text was changed by someone else. Reload to see the latest version.", { currentVersion: current.currentVersion })
  }
  return { ok: true, body: { success: true, asset: toAssetView(saved) } }
}
