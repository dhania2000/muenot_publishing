import ExcelJS from "exceljs"
import { describe, expect, it } from "vitest"
import { buildBatchWorkbook, literal, statusLabel, type WorkbookBatch } from "@/lib/alt-text/batch-xlsx"
import { DEFAULT_GENERATION_SETTINGS } from "@/lib/alt-text/core"
import type { BatchWorkbookAssetRow } from "@/lib/alt-text/store"

const batch: WorkbookBatch = {
  id: "b-1",
  name: "Chapter 4 figures",
  description: null,
  projectName: null,
  createdBy: 7,
  createdAt: "2026-10-01T10:00:00.000Z",
  status: "partially_completed",
  settings: DEFAULT_GENERATION_SETTINGS,
  stats: { total: 3, pending: 0, processing: 0, completed: 2, failed: 1 },
}

const asset = (over: Partial<BatchWorkbookAssetRow>): BatchWorkbookAssetRow => ({
  id: 1,
  fileName: "fig.png",
  status: "approved",
  language: "en",
  classification: "informative",
  shortAlt: "A bar chart",
  longDescription: null,
  extractedText: null,
  warnings: [],
  modelId: "model-x",
  currentVersion: 1,
  settingsOverride: null,
  updatedAt: "2026-10-02T10:00:00.000Z",
  mimeType: "image/png",
  sizeBytes: 2048,
  attempts: 1,
  errorMessage: null,
  ...over,
})

async function load(assets: BatchWorkbookAssetRow[]) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load((await buildBatchWorkbook(batch, assets)).buffer as ArrayBuffer)
  return wb
}

describe("batch XLSX workbook", () => {
  it("has the five sheets in order", async () => {
    const wb = await load([asset({})])
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Batch Summary", "Image Details", "Alt Text", "Review Warnings", "Processing Status"])
  })

  it("keeps formula-like text literal and never writes formulas", async () => {
    const wb = await load([asset({ fileName: "=HYPERLINK(\"x\")", shortAlt: "=SUM(A1)", warnings: ["+cmd"] })])
    const alt = wb.getWorksheet("Alt Text")!
    expect(alt.getRow(2).getCell(6).value).toBe("=SUM(A1)")
    expect(alt.getRow(2).getCell(2).value).toBe('=HYPERLINK("x")')
    wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((cell) => expect(cell.type).not.toBe(ExcelJS.ValueType.Formula))))
  })

  it("lists only exportable images on Alt Text but every image on status sheets", async () => {
    const wb = await load([
      asset({ id: 1 }),
      asset({ id: 2, fileName: "bad.png", status: "failed", classification: null, shortAlt: null, errorMessage: "Unsupported image" }),
      asset({ id: 3, fileName: "deco.png", classification: "decorative", shortAlt: "" }),
    ])
    expect(wb.getWorksheet("Alt Text")!.rowCount).toBe(3)
    expect(wb.getWorksheet("Image Details")!.rowCount).toBe(4)
    const status = wb.getWorksheet("Processing Status")!
    expect(status.getRow(3).getCell(3).value).toBe("Failed")
    expect(status.getRow(3).getCell(5).value).toBe("Unsupported image")
  })

  it("shows a placeholder row when there are no warnings", async () => {
    const wb = await load([asset({})])
    expect(wb.getWorksheet("Review Warnings")!.getRow(2).getCell(2).value).toBe("No review warnings recorded")
  })

  it("strips XML-illegal characters and caps cell length", () => {
    expect(literal("a\u0001b")).toBe("ab")
    expect(literal("x".repeat(40000)).length).toBeLessThanOrEqual(32767)
  })

  it("labels blocked uploads", () => {
    expect(statusLabel({ status: "uploaded", errorMessage: "Quota" })).toBe("Blocked")
    expect(statusLabel({ status: "uploaded", errorMessage: null })).toBe("Pending")
  })
})
