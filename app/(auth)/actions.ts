"use server"
import { redirect } from "next/navigation"
import { createSession, destroySession, hashPassword, verifyPassword } from "@/lib/auth"
import { query } from "@/lib/db"
import { ensurePlatformSchema } from "@/lib/platform-schema"
import { checkRateLimit } from "@/lib/rate-limit"
import { DEFAULT_TENANT_ID } from "@/lib/tenant-scope"

export type AuthState = { error?: string; email?: string; name?: string } | undefined

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const HOME = "/modules/publishing/alt-text"

function readEmail(formData: FormData) {
  return String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 255)
}

async function limited(key: string) {
  const result = await checkRateLimit(key, { max: 10, windowMs: 60_000 })
  return !result.allowed
}

export async function signInAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = readEmail(formData)
  const password = String(formData.get("password") ?? "")
  if (!EMAIL_RE.test(email) || !password) return { error: "Enter your email and password.", email }
  if (await limited(`signin:${email}`)) return { error: "Too many attempts. Try again in a minute.", email }

  try {
    await ensurePlatformSchema()
    const rows = await query<any[]>("SELECT id, password_hash, status FROM users WHERE email = ? LIMIT 1", [email])
    const user = rows[0]
    const valid = user ? await verifyPassword(password, user.password_hash) : await hashPassword(password).then(() => false)
    if (!user || !valid || user.status !== "active") return { error: "Invalid email or password.", email }
    await createSession(Number(user.id))
  } catch (error) {
    console.error("[auth] sign-in failed", error instanceof Error ? error.message : error)
    return { error: "Sign-in is temporarily unavailable. Check the database connection.", email }
  }
  redirect(HOME)
}

export async function signUpAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = readEmail(formData)
  const name = String(formData.get("name") ?? "").trim().slice(0, 160)
  const password = String(formData.get("password") ?? "")
  if (!name) return { error: "Enter your name.", email, name }
  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address.", email, name }
  if (password.length < 8 || password.length > 200) return { error: "Password must be at least 8 characters.", email, name }
  if (await limited(`signup:${email}`)) return { error: "Too many attempts. Try again in a minute.", email, name }

  try {
    await ensurePlatformSchema()
    const [{ count }] = await query<any[]>("SELECT COUNT(*) AS count FROM users")
    const isFirstUser = Number(count) === 0
    if (!isFirstUser && process.env.ALLOW_SIGNUP !== "true") {
      return { error: "Sign-up is closed. Ask an administrator for an account.", email, name }
    }
    const existing = await query<any[]>("SELECT id FROM users WHERE email = ? LIMIT 1", [email])
    if (existing.length) return { error: "An account with this email already exists.", email, name }
    const result = await query<any>(
      "INSERT INTO users (tenant_id, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?)",
      [DEFAULT_TENANT_ID, email, name, await hashPassword(password), isFirstUser ? "admin" : "employee"],
    )
    await createSession(Number(result.insertId))
  } catch (error) {
    console.error("[auth] sign-up failed", error instanceof Error ? error.message : error)
    return { error: "Sign-up is temporarily unavailable. Check the database connection.", email, name }
  }
  redirect(HOME)
}

export async function signOutAction() {
  await destroySession()
  redirect("/login")
}
