"use client"

/**
 * @file components/publishing/alt-text/use-bulk-image-queue.ts
 * @module Publishing
 * @kind React hook
 * @summary Phase 2 Tasks 2–3 — local, in-memory Bulk Processing image queue with bounded-concurrency
 *   validation (signature, dimensions, decode) and SHA-256 duplicate detection. Only `validFiles`
 *   are eligible for Task 6 uploads; the server must re-validate everything.
 */
import { useEffect, useMemo, useState } from "react"
import {
  checkBulkFile,
  duplicateKey,
  exceedsBatchLimit,
  validateBulkImageContent,
  BULK_MAX_TOTAL_MB,
  type BulkImageItem,
  type BulkImageStatus,
  type ContentValidation,
} from "@/lib/alt-text/bulk-queue"
import type { SupportedImageType } from "@/lib/alt-text/core"

const CONCURRENCY = 3
const CHUNK_SIZE = 50
const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

type EngineOptions = {
  onChange: (items: BulkImageItem[]) => void
  onHashUnavailable: () => void
  validate?: (file: File, type: SupportedImageType) => Promise<ContentValidation>
  createUrl?: (file: File) => string
  revokeUrl?: (url: string) => void
}

/** Framework-free queue engine so ordering, hashing and stale-result rules are unit-testable. */
export function createBulkQueueEngine({
  onChange,
  onHashUnavailable,
  validate = validateBulkImageContent,
  createUrl = (file) => URL.createObjectURL(file),
  revokeUrl = (url) => URL.revokeObjectURL(url),
}: EngineOptions) {
  const items = new Map<string, BulkImageItem>()
  const attempts = new Map<string, number>()
  const metaIndex = new Map<string, string>()
  const hashIndex = new Map<string, string>()
  const pending: string[] = []
  let active = 0
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  const idle: Array<() => void> = []

  const flush = () => {
    if (flushTimer) return
    flushTimer = setTimeout(() => {
      flushTimer = null
      onChange(Array.from(items.values()))
    }, 16)
  }
  const set = (id: string, update: Partial<BulkImageItem>) => {
    const current = items.get(id)
    if (!current) return
    items.set(id, { ...current, ...update })
    flush()
  }
  const releaseIndexes = (id: string) => {
    for (const [key, owner] of metaIndex) if (owner === id) metaIndex.delete(key)
    for (const [hash, owner] of hashIndex) if (owner === id) hashIndex.delete(hash)
  }
  const acceptedBytes = (except: string) => {
    let total = 0
    for (const item of items.values()) if (item.id !== except && (item.status === "valid" || item.status === "validating")) total += item.size
    return total
  }

  async function run(id: string) {
    const item = items.get(id)
    if (!item) return
    const attempt = attempts.get(id)
    const isStale = () => !items.has(id) || attempts.get(id) !== attempt

    const check = checkBulkFile(item.file)
    if (!check.ok) return set(id, { status: "invalid", error: check.reason })
    const key = duplicateKey(item.file)
    const metaOwner = metaIndex.get(key)
    if (metaOwner && metaOwner !== id && items.has(metaOwner)) {
      return set(id, { status: "duplicate", type: check.type, error: `Same file as "${items.get(metaOwner)!.name}" (matching name, size and date)` })
    }
    if (exceedsBatchLimit(acceptedBytes(id), item.size)) return set(id, { status: "invalid", error: `Selection would exceed ${BULK_MAX_TOTAL_MB / 1024} GB in total` })
    metaIndex.set(key, id)
    set(id, { status: "validating", type: check.type, error: undefined })

    let result: ContentValidation
    try {
      result = await validate(item.file, check.type)
    } catch {
      result = { ok: false, reason: "File could not be read — it may have been moved or deleted" }
    }
    if (isStale()) return
    if (!result.ok) {
      releaseIndexes(id)
      return set(id, { status: "invalid", error: result.reason })
    }
    const base = { type: result.type, width: result.width, height: result.height, hash: result.hash }
    if (result.hash) {
      const owner = hashIndex.get(result.hash)
      if (owner && owner !== id && items.has(owner)) {
        releaseIndexes(id)
        return set(id, { ...base, status: "duplicate", error: `Identical content to "${items.get(owner)!.name}" (SHA-256 match)` })
      }
      hashIndex.set(result.hash, id)
    } else {
      onHashUnavailable()
    }
    set(id, { ...base, status: "valid", error: undefined })
  }

  function pump() {
    while (active < CONCURRENCY && pending.length) {
      const id = pending.shift()!
      if (!items.has(id)) continue
      active++
      void run(id).finally(() => {
        active--
        pump()
      })
    }
    if (active === 0 && pending.length === 0) idle.splice(0).forEach((resolve) => resolve())
  }

  const enqueue = (id: string) => {
    attempts.set(id, (attempts.get(id) ?? 0) + 1)
    pending.push(id)
  }

  const removeIds = (ids: string[]) => {
    for (const id of ids) {
      const item = items.get(id)
      if (!item) continue
      revokeUrl(item.previewUrl)
      releaseIndexes(id)
      items.delete(id)
      attempts.delete(id)
    }
    flush()
  }

  return {
    async add(files: File[]) {
      for (let start = 0; start < files.length; start += CHUNK_SIZE) {
        for (const file of files.slice(start, start + CHUNK_SIZE)) {
          const id = crypto.randomUUID()
          items.set(id, { id, file, name: file.name, type: null, size: file.size, lastModified: file.lastModified, previewUrl: createUrl(file), status: "pending" })
          enqueue(id)
        }
        flush()
        pump()
        if (start + CHUNK_SIZE < files.length) await yieldToBrowser()
      }
    },
    remove: (id: string) => removeIds([id]),
    removeByStatus: (statuses: BulkImageStatus[]) => removeIds(Array.from(items.values()).filter((i) => statuses.includes(i.status)).map((i) => i.id)),
    retry() {
      for (const item of items.values()) {
        if (item.status !== "invalid" && item.status !== "duplicate") continue
        items.set(item.id, { ...item, status: "pending", error: undefined })
        enqueue(item.id)
      }
      flush()
      pump()
    },
    clear: () => removeIds(Array.from(items.keys())),
    /** Resolves once no validation work is queued or running. */
    whenIdle: () => new Promise<void>((resolve) => (active === 0 && pending.length === 0 ? resolve() : idle.push(resolve))),
    snapshot: () => Array.from(items.values()),
  }
}

export function useBulkImageQueue() {
  const [items, setItems] = useState<BulkImageItem[]>([])
  const [hashUnavailable, setHashUnavailable] = useState(false)
  const [engine] = useState(() => createBulkQueueEngine({ onChange: setItems, onHashUnavailable: () => setHashUnavailable(true) }))

  useEffect(() => () => engine.clear(), [engine])

  const summary = useMemo(() => {
    const counts = { total: items.length, valid: 0, invalid: 0, duplicate: 0, pending: 0 }
    for (const item of items) {
      if (item.status === "valid") counts.valid++
      else if (item.status === "invalid") counts.invalid++
      else if (item.status === "duplicate") counts.duplicate++
      else counts.pending++
    }
    return counts
  }, [items])

  /** Validated, unique originals — the only files eligible for upload and AI processing. */
  const validFiles = useMemo(() => items.filter((item) => item.status === "valid").map((item) => item.file), [items])

  return {
    items,
    summary,
    validFiles,
    validating: summary.pending > 0,
    hashUnavailable,
    addFiles: engine.add,
    removeImage: engine.remove,
    removeInvalid: () => engine.removeByStatus(["invalid"]),
    removeDuplicates: () => engine.removeByStatus(["duplicate"]),
    retryValidation: engine.retry,
    clearAll: engine.clear,
  }
}

export type BulkImageQueue = ReturnType<typeof useBulkImageQueue>
