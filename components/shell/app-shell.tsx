import Link from "next/link"
import { BookOpen, ImageIcon, LogOut } from "lucide-react"
import { signOutAction } from "@/app/(auth)/actions"
import { Button } from "@/components/ui/button"
import type { Session } from "@/lib/auth"

const NAV = [{ href: "/modules/publishing/alt-text", label: "Alt Text Writer", Icon: ImageIcon }]

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?"
}

export function AppShell({ session, children }: { session: Session; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-sidebar-border bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:h-dvh md:w-60 md:border-b-0 md:border-r">
        <div className="flex h-14 items-center gap-2 px-4">
          <BookOpen className="size-5 text-primary" aria-hidden="true" />
          <span className="text-sm font-semibold">Muenot Publishing</span>
        </div>
        <nav aria-label="Primary" className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-1 md:flex-col md:pb-0">
          <p className="hidden px-2 pb-1 pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground md:block">Publishing</p>
          {NAV.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>
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
