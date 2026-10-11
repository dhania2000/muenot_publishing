import { timingSafeEqual } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"
import { runDueBackgroundJobs } from "@/lib/background-jobs"

export const maxDuration = 300

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const provided = Buffer.from(request.headers.get("authorization") ?? "")
  const expected = Buffer.from(`Bearer ${secret}`)
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

/** Drains due background jobs. Invoked by Vercel Cron (Authorization: Bearer CRON_SECRET). */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const outcomes = await runDueBackgroundJobs()
  return NextResponse.json({ processed: outcomes.length, outcomes }, { headers: { "Cache-Control": "no-store" } })
}
