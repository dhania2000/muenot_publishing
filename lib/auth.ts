import "server-only"
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"
import { cookies } from "next/headers"
import { cache } from "react"
import { query } from "@/lib/db"
import { DEFAULT_TENANT_ID } from "@/lib/tenant-scope"

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number) => Promise<Buffer>

export const SESSION_COOKIE = "publishing_session"
const SESSION_DAYS = 14

export type Session = {
  userId: number
  tenantId: number
  role: "admin" | "employee"
  email: string
  name: string
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, 64)
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltHex, keyHex] = stored.split("$")
  if (algo !== "scrypt" || !saltHex || !keyHex) return false
  const expected = Buffer.from(keyHex, "hex")
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length)
  return timingSafeEqual(expected, actual)
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex")

export async function createSession(userId: number): Promise<void> {
  const token = randomBytes(32).toString("base64url")
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000)
  await query("INSERT INTO app_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", [hashToken(token), userId, expires])
  const jar = await cookies()
  jar.set(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "none", path: "/", expires })
}

export async function destroySession(): Promise<void> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (token) await query("DELETE FROM app_sessions WHERE token_hash = ?", [hashToken(token)]).catch(() => {})
  jar.delete(SESSION_COOKIE)
}

export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) return null
  const rows = await query<any[]>(
    `SELECT u.id, u.email, u.name, u.role FROM app_sessions s JOIN app_users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP() LIMIT 1`,
    [hashToken(token)],
  )
  const row = rows[0]
  if (!row) return null
  return { userId: Number(row.id), tenantId: DEFAULT_TENANT_ID, role: row.role === "admin" ? "admin" : "employee", email: row.email, name: row.name }
})
