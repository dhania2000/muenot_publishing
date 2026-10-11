import { describe, expect, it, vi } from "vitest"
import { checkBulkFile, validateBulkImageContent } from "@/lib/alt-text/bulk-queue"
import { createBulkQueueEngine } from "@/components/publishing/alt-text/use-bulk-image-queue"

const png = (w: number, h: number, salt = 0) => {
  const b = new Uint8Array(40)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(b.buffer).setUint32(16, w)
  new DataView(b.buffer).setUint32(20, h)
  b[39] = salt
  return b
}
const jpeg = (w: number, h: number) => {
  const b = new Uint8Array(32)
  b.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff])
  return b
}
const webp = (w: number, h: number) => {
  const b = new Uint8Array(32)
  b.set([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBPVP8X")])
  b.set([(w - 1) & 0xff, (w - 1) >> 8, 0, (h - 1) & 0xff, (h - 1) >> 8, 0], 24)
  return b
}
const file = (bytes: Uint8Array | string, name: string, type: string, lastModified = 1) => new File([bytes as BlobPart], name, { type, lastModified })
const decodes = async () => true

describe("bulk image content validation", () => {
  it("accepts valid JPG, PNG and WEBP and extracts dimensions", async () => {
    await expect(validateBulkImageContent(file(jpeg(640, 480), "a.jpg", "image/jpeg"), "image/jpeg", decodes)).resolves.toMatchObject({ ok: true, width: 640, height: 480 })
    await expect(validateBulkImageContent(file(png(800, 600), "a.png", "image/png"), "image/png", decodes)).resolves.toMatchObject({ ok: true, width: 800, height: 600 })
    const r = await validateBulkImageContent(file(webp(300, 200), "a.webp", "image/webp"), "image/webp", decodes)
    expect(r).toMatchObject({ ok: true, width: 300, height: 200 })
    expect(r.ok && r.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("rejects unsupported formats, empty and oversized files before reading", () => {
    for (const [name, type] of [["a.gif", "image/gif"], ["a.svg", "image/svg+xml"], ["a.bmp", "image/bmp"], ["a.heic", "image/heic"], ["a.pdf", "application/pdf"], ["a.exe", ""]]) {
      expect(checkBulkFile(file("x", name, type)).ok).toBe(false)
    }
    expect(checkBulkFile(file("", "a.png", "image/png"))).toMatchObject({ ok: false, reason: "File is empty" })
    const big = file("x", "a.png", "image/png")
    Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 })
    expect(checkBulkFile(big)).toMatchObject({ ok: false })
  })

  it("rejects fake extensions, type mismatches and corrupt images", async () => {
    expect(await validateBulkImageContent(file("MZ executable", "evil.png", "image/png"), "image/png", decodes)).toMatchObject({ ok: false })
    expect(await validateBulkImageContent(file(png(100, 100), "x.jpg", "image/jpeg"), "image/jpeg", decodes)).toMatchObject({ ok: false, reason: expect.stringContaining("PNG") })
    expect(await validateBulkImageContent(file(png(100, 100), "x.png", "image/png"), "image/png", async () => false)).toMatchObject({ ok: false, reason: expect.stringContaining("decoded") })
  })
})

describe("bulk queue engine", () => {
  const setup = () => {
    let items: ReturnType<ReturnType<typeof createBulkQueueEngine>["snapshot"]> = []
    const engine = createBulkQueueEngine({
      onChange: (next) => (items = next),
      onHashUnavailable: vi.fn(),
      validate: (f, t) => validateBulkImageContent(f, t, decodes),
      createUrl: () => "blob:test",
      revokeUrl: () => {},
    })
    return { engine, get: () => engine.snapshot(), last: () => items }
  }

  it("detects identical content across names and separate adds, keeps the first, accepts unique", async () => {
    const { engine, get } = setup()
    await engine.add([file(png(64, 64), "first.png", "image/png")])
    await engine.whenIdle()
    await engine.add([file(png(64, 64), "renamed.png", "image/png", 2), file(png(64, 64, 9), "unique.png", "image/png", 3), file("x", "bad.gif", "image/gif")])
    await engine.whenIdle()
    const byName = Object.fromEntries(get().map((i) => [i.name, i]))
    expect(byName["first.png"].status).toBe("valid")
    expect(byName["renamed.png"]).toMatchObject({ status: "duplicate", error: expect.stringContaining("first.png") })
    expect(byName["unique.png"].status).toBe("valid")
    expect(byName["bad.gif"].status).toBe("invalid")
  })

  it("remove frees the hash so a re-add is accepted; removing during validation leaves no stale item", async () => {
    const { engine, get } = setup()
    await engine.add([file(png(64, 64), "a.png", "image/png")])
    await engine.whenIdle()
    engine.remove(get()[0].id)
    await engine.add([file(png(64, 64), "a.png", "image/png")])
    await engine.whenIdle()
    expect(get().map((i) => i.status)).toEqual(["valid"])

    await engine.add([file(png(32, 32, 5), "b.png", "image/png", 7)])
    engine.remove(get()[1].id)
    await engine.whenIdle()
    expect(get()).toHaveLength(1)
  })

  it("validates a large batch with bounded concurrency", async () => {
    let active = 0
    let peak = 0
    const engine = createBulkQueueEngine({
      onChange: () => {},
      onHashUnavailable: () => {},
      createUrl: () => "blob:test",
      revokeUrl: () => {},
      validate: async (f, t) => {
        peak = Math.max(peak, ++active)
        const r = await validateBulkImageContent(f, t, decodes)
        active--
        return r
      },
    })
    await engine.add(Array.from({ length: 300 }, (_, i) => file(png(64, 64, i % 256), `img-${i}.png`, "image/png", i)))
    await engine.whenIdle()
    const items = engine.snapshot()
    expect(peak).toBeLessThanOrEqual(3)
    expect(items.filter((i) => i.status === "valid")).toHaveLength(256)
    expect(items.filter((i) => i.status === "duplicate")).toHaveLength(44)
  })
})
