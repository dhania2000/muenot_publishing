"use server"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { getSession } from "@/lib/auth"
import { query } from "@/lib/db"
import { sendMail } from "@/lib/mailer"

const PATH = "/admin/users"

async function requireAdmin() {
  const session = await getSession()
  if (!session || session.role !== "admin") throw new Error("Not authorized")
  return session
}

function parseId(value: unknown) {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid user")
  return id
}

async function loginUrl() {
  const configured = process.env.APP_URL?.replace(/\/+$/, "")
  if (configured) return `${configured}/login`
  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")
  return `${proto}://${host}/login`
}

export async function approveUserAction(userId: number) {
  const admin = await requireAdmin()
  const id = parseId(userId)
  const result = await query<any>(
    "UPDATE users SET status = 'active', approved_by = ?, approved_at = UTC_TIMESTAMP() WHERE id = ? AND tenant_id = ? AND status = 'pending'",
    [admin.userId, id, admin.tenantId],
  )
  if (result.affectedRows) {
    const [user] = await query<any[]>("SELECT email, name FROM users WHERE id = ? LIMIT 1", [id])
    if (user) {
      const link = await loginUrl()
      await sendMail({
        to: user.email,
        subject: "Your Muenot Publishing account is approved",
        text: `Hi ${user.name},\n\nAn administrator approved your account. You can sign in now:\n${link}`,
        html: `<p>Hi ${escapeHtml(user.name)},</p><p>An administrator approved your account. You can sign in now.</p><p><a href="${link}">Sign in</a></p>`,
      }).catch((error) => console.error("[admin] approval email failed", error instanceof Error ? error.message : error))
    }
  }
  revalidatePath(PATH, "layout")
}

export async function rejectUserAction(userId: number) {
  const admin = await requireAdmin()
  await query("DELETE FROM users WHERE id = ? AND tenant_id = ? AND status = 'pending'", [parseId(userId), admin.tenantId])
  revalidatePath(PATH, "layout")
}

export async function disableUserAction(userId: number) {
  const admin = await requireAdmin()
  const id = parseId(userId)
  if (id === admin.userId) throw new Error("You can't disable your own account")
  const result = await query<any>(
    "UPDATE users SET status = 'disabled' WHERE id = ? AND tenant_id = ? AND status = 'active'",
    [id, admin.tenantId],
  )
  if (result.affectedRows) await query("DELETE FROM app_sessions WHERE user_id = ?", [id])
  revalidatePath(PATH, "layout")
}

export async function enableUserAction(userId: number) {
  const admin = await requireAdmin()
  await query("UPDATE users SET status = 'active' WHERE id = ? AND tenant_id = ? AND status = 'disabled'", [
    parseId(userId),
    admin.tenantId,
  ])
  revalidatePath(PATH, "layout")
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
}
