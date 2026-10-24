"use server"
import { createHash, randomBytes } from "node:crypto"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { sendMail } from "@/lib/mailer"
import { createSession, destroySession, hashPassword, verifyPassword } from "@/lib/auth"
import { query } from "@/lib/db"
import { ensurePlatformSchema } from "@/lib/platform-schema"
import { checkRateLimit } from "@/lib/rate-limit"
import { DEFAULT_TENANT_ID } from "@/lib/tenant-scope"

export type AuthState = { error?: string; email?: string; name?: string; pending?: boolean } | undefined

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
    if (!user || !valid) return { error: "Invalid email or password.", email }
    if (user.status === "pending") return { error: "Your account is awaiting administrator approval.", email }
    if (user.status !== "active") return { error: "This account has been disabled. Contact an administrator.", email }
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
    const existing = await query<any[]>("SELECT id FROM users WHERE email = ? LIMIT 1", [email])
    if (existing.length) return { error: "An account with this email already exists.", email, name }
    const result = await query<any>(
      "INSERT INTO users (tenant_id, email, name, password_hash, role, status, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        DEFAULT_TENANT_ID,
        email,
        name,
        await hashPassword(password),
        isFirstUser ? "admin" : "employee",
        isFirstUser ? "active" : "pending",
        isFirstUser ? new Date() : null,
      ],
    )
    if (!isFirstUser) {
      await notifyAdminsOfSignup(name, email).catch((error) =>
        console.error("[auth] admin notification failed", error instanceof Error ? error.message : error),
      )
      return { pending: true, email }
    }
    await createSession(Number(result.insertId))
  } catch (error) {
    console.error("[auth] sign-up failed", error instanceof Error ? error.message : error)
    return { error: "Sign-up is temporarily unavailable. Check the database connection.", email, name }
  }
  redirect(HOME)
}

async function notifyAdminsOfSignup(name: string, email: string) {
  const admins = await query<any[]>(
    "SELECT email FROM users WHERE tenant_id = ? AND role = 'admin' AND status = 'active'",
    [DEFAULT_TENANT_ID],
  )
  const link = `${await appOrigin()}/admin/users`
  await Promise.all(
    admins.map((admin) =>
      sendMail({
        to: admin.email,
        subject: "New account awaiting approval",
        text: `${name} (${email}) created an account on Muenot Services and is waiting for approval.\n\nReview it here: ${link}`,
        html: `<p>${escapeHtml(name)} (${escapeHtml(email)}) created an account on Muenot Services and is waiting for approval.</p><p><a href="${link}">Review pending accounts</a></p>`,
      }),
    ),
  )
}

export type ResetRequestState = { error?: string; sent?: boolean; email?: string } | undefined

const RESET_MINUTES = 30
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex")

async function appOrigin() {
  const configured = process.env.APP_URL?.replace(/\/+$/, "")
  if (configured) return configured
  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")
  return `${proto}://${host}`
}

export async function requestPasswordResetAction(_prev: ResetRequestState, formData: FormData): Promise<ResetRequestState> {
  const email = readEmail(formData)
  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address.", email }
  if (await limited(`reset-request:${email}`)) return { error: "Too many attempts. Try again in a minute.", email }

  try {
    await ensurePlatformSchema()
    const rows = await query<any[]>("SELECT id, name FROM users WHERE email = ? AND status = 'active' LIMIT 1", [email])
    const user = rows[0]
    if (user) {
      const token = randomBytes(32).toString("base64url")
      const expires = new Date(Date.now() + RESET_MINUTES * 60_000)
      await query("DELETE FROM password_resets WHERE user_id = ?", [user.id])
      await query("INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)", [hashToken(token), user.id, expires])
      const link = `${await appOrigin()}/reset-password?token=${encodeURIComponent(token)}`
      await sendMail({
        to: email,
        subject: "Reset your Muenot Services password",
        text: `Hi ${user.name},\n\nUse this link to set a new password. It expires in ${RESET_MINUTES} minutes and can be used once:\n${link}\n\nIf you didn't request this, you can ignore this email.`,
        html: `<p>Hi ${escapeHtml(user.name)},</p><p>Use the link below to set a new password. It expires in ${RESET_MINUTES} minutes and can be used once.</p><p><a href="${link}">Reset password</a></p><p>If you didn't request this, you can ignore this email.</p>`,
      })
    }
  } catch (error) {
    console.error("[auth] reset request failed", error instanceof Error ? error.message : error)
    return { error: "Password reset is temporarily unavailable. Try again later.", email }
  }
  return { sent: true, email }
}

export type ResetPasswordState = { error?: string } | undefined

export async function resetPasswordAction(_prev: ResetPasswordState, formData: FormData): Promise<ResetPasswordState> {
  const token = String(formData.get("token") ?? "")
  const password = String(formData.get("password") ?? "")
  const confirm = String(formData.get("confirm") ?? "")
  if (!token) return { error: "This reset link is invalid. Request a new one." }
  if (password.length < 8 || password.length > 200) return { error: "Password must be at least 8 characters." }
  if (password !== confirm) return { error: "Passwords do not match." }
  if (await limited(`reset:${hashToken(token)}`)) return { error: "Too many attempts. Try again in a minute." }

  try {
    await ensurePlatformSchema()
    const tokenHash = hashToken(token)
    const claimed = await query<any>(
      "UPDATE password_resets SET used_at = UTC_TIMESTAMP() WHERE token_hash = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP()",
      [tokenHash],
    )
    if (!claimed.affectedRows) return { error: "This reset link has expired or was already used. Request a new one." }
    const [row] = await query<any[]>("SELECT user_id FROM password_resets WHERE token_hash = ? LIMIT 1", [tokenHash])
    const userId = Number(row.user_id)
    await query("UPDATE users SET password_hash = ? WHERE id = ? AND status = 'active'", [await hashPassword(password), userId])
    await query("DELETE FROM app_sessions WHERE user_id = ?", [userId])
    await query("DELETE FROM password_resets WHERE user_id = ? AND token_hash <> ?", [userId, tokenHash])
  } catch (error) {
    console.error("[auth] reset failed", error instanceof Error ? error.message : error)
    return { error: "Password reset is temporarily unavailable. Try again later." }
  }
  redirect("/login?reset=1")
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
}

export async function signOutAction() {
  await destroySession()
  redirect("/login")
}
