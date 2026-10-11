import { describe, expect, it } from "vitest"
import { altTextConcurrencyFromEnv, classifyHalt, haltDelaySeconds, parseRetryAfter, retryAfterFromError } from "@/lib/alt-text/concurrency"
import { globalRunningCapFor } from "@/lib/observability/job-limits"

const cfg = altTextConcurrencyFromEnv({})

describe("alt text concurrency config", () => {
  it("uses safe defaults", () => {
    expect(cfg).toMatchObject({ tenantMaxConcurrency: 2, globalMaxConcurrency: 3, retryBaseSeconds: 60, retryMaxSeconds: 1800 })
  })
  it("clamps env overrides and ignores garbage", () => {
    const c = altTextConcurrencyFromEnv({ ALT_TEXT_TENANT_MAX_CONCURRENCY: "500", ALT_TEXT_GLOBAL_MAX_CONCURRENCY: "abc", ALT_TEXT_RETRY_BASE_SECONDS: "1" })
    expect(c.tenantMaxConcurrency).toBe(20)
    expect(c.globalMaxConcurrency).toBe(3)
    expect(c.retryBaseSeconds).toBe(30)
  })
  it("applies a global running cap only to alt text batch jobs", () => {
    expect(globalRunningCapFor("alt_text.batch_processing", { ALT_TEXT_GLOBAL_MAX_CONCURRENCY: "5" })).toBe(5)
    expect(globalRunningCapFor("email.send", {})).toBeNull()
  })
})

describe("classifyHalt", () => {
  it("separates rate limits, credits, transient and config halts", () => {
    expect(classifyHalt({ status: 429, code: "RATE_LIMITED" })).toBe("rate_limited")
    expect(classifyHalt({ status: 402, code: "INSUFFICIENT_CREDITS" })).toBe("credits")
    expect(classifyHalt({ status: 504, code: "PROVIDER_TIMEOUT" })).toBe("transient")
    expect(classifyHalt({ status: 502, code: "PROVIDER_ERROR" })).toBe("transient")
    expect(classifyHalt({ status: 502, code: "PROVIDER_ERROR", details: { reason: "credentials" } })).toBe("config")
    expect(classifyHalt({ status: 403, code: "MODEL_NOT_ALLOWED" })).toBe("config")
  })
})

describe("haltDelaySeconds", () => {
  it("grows exponentially, is bounded and jittered", () => {
    expect(haltDelaySeconds("rate_limited", 0, null, cfg, () => 1)).toBe(60)
    expect(haltDelaySeconds("rate_limited", 0, null, cfg, () => 0)).toBe(30)
    expect(haltDelaySeconds("rate_limited", 3, null, cfg, () => 1)).toBe(480)
    expect(haltDelaySeconds("rate_limited", 50, null, cfg, () => 1)).toBe(1800)
  })
  it("never shortens a provider Retry-After", () => {
    expect(haltDelaySeconds("rate_limited", 0, 900, cfg, () => 0)).toBe(900)
  })
  it("waits longer for credits", () => {
    expect(haltDelaySeconds("credits", 0, null, cfg, () => 1)).toBe(900)
  })
})

describe("Retry-After parsing", () => {
  it("parses seconds and HTTP dates with bounds", () => {
    expect(parseRetryAfter("120")).toBe(120)
    expect(parseRetryAfter("999999")).toBe(3600)
    expect(parseRetryAfter(new Date(1_000_000 + 45_000).toUTCString(), 1_000_000)).toBe(45)
    expect(parseRetryAfter("soon")).toBeNull()
    expect(parseRetryAfter(undefined)).toBeNull()
  })
  it("reads only the header from APICallError or a RetryError's lastError", () => {
    expect(retryAfterFromError({ responseHeaders: { "retry-after": "30" } })).toBe(30)
    expect(retryAfterFromError({ lastError: { responseHeaders: { "retry-after": "7" } } })).toBe(7)
    expect(retryAfterFromError(new Error("x"))).toBeNull()
  })
})
