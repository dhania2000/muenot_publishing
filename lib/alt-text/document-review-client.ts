/**
 * @file lib/alt-text/document-review-client.ts
 * @module Publishing · Alt Text
 * @kind Client library
 * @summary Browser helpers for the Phase 3 Task 14 description review routes.
 */
import { toApiError, type ApiResult } from "./client"
import type {
  BulkReviewAction,
  BulkReviewResponse,
  CommentCategory,
  DecisionResponse,
  DraftSaveResponse,
  ReviewAction,
  ReviewQueueFilter,
} from "./document-approval-contract"

export const REVIEW_PAGE_SIZE = 25

export const reviewQueueUrl = (documentId: number, page: number, filter: ReviewQueueFilter) => {
  const sp = new URLSearchParams({ page: String(page), pageSize: String(REVIEW_PAGE_SIZE) })
  if (filter !== "all") sp.set("status", filter)
  return `/api/alt-text/documents/${documentId}/review?${sp}`
}

export const reviewDetailUrl = (documentId: number, imageId: number) => `/api/alt-text/documents/${documentId}/review/${imageId}`

async function send<T>(url: string, method: "POST" | "PATCH", body: unknown): Promise<ApiResult<T>> {
  let res: Response
  try {
    res = await fetch(url, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  } catch {
    return { ok: false, error: toApiError(0, null) }
  }
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok || !data || (data as { success?: unknown }).success !== true) return { ok: false, error: toApiError(res.status, data) }
  return { ok: true, data: data as T }
}

export type DecisionPayload = {
  action: ReviewAction
  expectedVersion: number
  comment?: string | null
  category?: CommentCategory | null
  decorative?: boolean
  justification?: string | null
}

export const submitReviewDecision = (documentId: number, imageId: number, payload: DecisionPayload) =>
  send<DecisionResponse>(`${reviewDetailUrl(documentId, imageId)}/decision`, "POST", payload)

export const saveReviewDraft = (documentId: number, imageId: number, payload: { expectedVersion: number; shortAlt?: string; longDescription?: string }) =>
  send<DraftSaveResponse>(reviewDetailUrl(documentId, imageId), "PATCH", payload)

export const submitBulkReview = (
  documentId: number,
  payload: { action: BulkReviewAction; items: { imageId: number; expectedVersion: number }[]; comment?: string | null; category?: CommentCategory | null },
) => send<BulkReviewResponse>(`/api/alt-text/documents/${documentId}/review/bulk`, "POST", payload)
