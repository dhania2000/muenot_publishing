const REQUIRED_ENV = ['DATABASE_URL', 'APP_URL'] as const

function mb(bytes: number) {
  return `${Math.round(bytes / 1024 / 1024)}MB`
}

function memorySummary() {
  const { rss, heapUsed } = process.memoryUsage()
  return `rss=${mb(rss)} heap=${mb(heapUsed)}`
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const missing = REQUIRED_ENV.filter((key) => !process.env[key])

  console.log(
    `[startup] pid=${process.pid} node=${process.version} PORT=${process.env.PORT ?? '(unset -> 3000)'} ` +
      `HOSTNAME=${process.env.HOSTNAME ?? '(unset)'} NODE_ENV=${process.env.NODE_ENV} ${memorySummary()}`,
  )
  if (missing.length > 0) {
    console.warn(`[startup] missing env: ${missing.join(', ')}`)
  }

  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.once(signal, () => {
      console.warn(
        `[shutdown] received ${signal} after ${Math.round(process.uptime())}s uptime (${memorySummary()})`,
      )
      process.exit(0)
    })
  }

  process.on('uncaughtException', (error) => {
    console.error('[fatal] uncaughtException', error)
    process.exit(1)
  })
  process.on('unhandledRejection', (reason) => {
    console.error('[fatal] unhandledRejection', reason)
  })

  const heartbeat = setInterval(() => {
    console.log(`[heartbeat] uptime=${Math.round(process.uptime())}s ${memorySummary()}`)
  }, 30_000)
  heartbeat.unref()
}
