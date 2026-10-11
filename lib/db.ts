import "server-only"
import mysql from "mysql2/promise"

declare global {
  var __publishingPool: mysql.Pool | undefined
}

function createPool(): mysql.Pool {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not configured")
  const parsed = new URL(url)
  const sslMode = parsed.searchParams.get("ssl") ?? parsed.searchParams.get("sslmode")
  return mysql.createPool({
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ""),
    ssl: sslMode === "false" || sslMode === "disable" ? undefined : { rejectUnauthorized: true },
    waitForConnections: true,
    connectionLimit: 10,
    timezone: "Z",
    charset: "utf8mb4",
  })
}

export function getPool(): mysql.Pool {
  globalThis.__publishingPool ??= createPool()
  return globalThis.__publishingPool
}

export async function query<T = any>(sql: string, params: any[] = []): Promise<T> {
  const [rows] = await getPool().query(sql, params)
  return rows as T
}

export async function withTransaction<T>(fn: (connection: mysql.PoolConnection) => Promise<T>): Promise<T> {
  const connection = await getPool().getConnection()
  try {
    await connection.beginTransaction()
    const result = await fn(connection)
    await connection.commit()
    return result
  } catch (error) {
    await connection.rollback().catch(() => {})
    throw error
  } finally {
    connection.release()
  }
}
