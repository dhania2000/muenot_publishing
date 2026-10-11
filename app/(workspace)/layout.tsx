import { redirect } from "next/navigation"
import { AppShell } from "@/components/shell/app-shell"
import { getSession } from "@/lib/auth"

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect("/login")
  return <AppShell session={session}>{children}</AppShell>
}
