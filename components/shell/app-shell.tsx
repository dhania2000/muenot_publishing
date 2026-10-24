import Link from "next/link"
import { BookOpen, LogOut } from "lucide-react"
import { signOutAction } from "@/app/(auth)/actions"
import { SidebarNav } from "@/components/shell/sidebar-nav"
import { Button } from "@/components/ui/button"
import type { Session } from "@/lib/auth"

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?"
}

export function AppShell({
  session,
  pendingCount = 0,
  children,
}: {
  session: Session
  pendingCount?: number
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-sidebar-border bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:h-dvh md:w-60 md:border-b-0 md:border-r">
        <div className="flex h-14 items-center gap-2 px-4">
          <BookOpen className="size-5 text-primary" aria-hidden="true" />
          <span className="text-sm font-semibold">Muenot Services</span>
        </div>
        <SidebarNav isAdmin={session.role === "admin"} pendingCount={pendingCount} />
        <div className="hidden items-center gap-3 border-t border-sidebar-border p-3 md:flex">
          <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
            {initials(session.name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{session.name}</p>
            <p className="truncate text-xs text-muted-foreground">{session.email}</p>
          </div>
          <form action={signOutAction}>
            <Button type="submit" variant="ghost" size="icon" aria-label="Sign out">
              <LogOut className="size-4" aria-hidden="true" />
            </Button>
          </form>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-end border-b border-border px-4 py-2 md:hidden">
          <form action={signOutAction}>
            <Button type="submit" variant="ghost" size="sm">
              <LogOut className="size-4" aria-hidden="true" />
              Sign out
            </Button>
          </form>
        </div>
        <main id="main">{children}</main>
      </div>
    </div>
  )
}
