import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { UserManagement, type ManagedUser } from "@/components/admin/user-management"
import { getSession } from "@/lib/auth"
import { query } from "@/lib/db"

export const metadata: Metadata = { title: "Users | Muenot Services" }

export default async function AdminUsersPage() {
  const session = await getSession()
  if (!session) redirect("/login")
  if (session.role !== "admin") redirect("/modules/publishing/alt-text")

  const rows = await query<any[]>(
    `SELECT id, name, email, role, status, created_at FROM users WHERE tenant_id = ?
     ORDER BY FIELD(status, 'pending', 'active', 'disabled'), created_at DESC`,
    [session.tenantId],
  )
  const users: ManagedUser[] = rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    email: String(row.email),
    role: row.role === "admin" ? "admin" : "employee",
    status: row.status === "pending" ? "pending" : row.status === "disabled" ? "disabled" : "active",
    createdAt: new Date(row.created_at).toISOString(),
  }))

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 md:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Users</h1>
        <p className="text-sm text-muted-foreground">
          Approve new sign-ups and manage who can access the workspace.
        </p>
      </header>
      <UserManagement users={users} currentUserId={session.userId} />
    </div>
  )
}
