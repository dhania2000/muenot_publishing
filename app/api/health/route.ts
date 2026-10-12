import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    port: process.env.PORT ?? null,
    nodeVersion: process.version,
    timestamp: new Date().toISOString(),
  })
}
