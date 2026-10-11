import { redirect } from "next/navigation"
import { AppShell } from "@/components/shell/app-shell"
import { getSession } from "@/lib/auth"
import { query } from "@/lib/db"

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect("/login")
  let pendingCount = 0
  if (session.role === "admin") {
    const [row] = await query<any[]>("SELECT COUNT(*) AS count FROM users WHERE tenant_id = ? AND status = 'pending'", [
      session.tenantId,
    ]).catch(() => [{ count: 0 }])
    pendingCount = Number(row?.count) || 0
  }
  return (
    <AppShell session={session} pendingCount={pendingCount}>
      {children}
    </AppShell>
  )
}
