import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { BookOpen } from "lucide-react"
import { AuthForm } from "@/components/auth/auth-form"
import { getSession } from "@/lib/auth"

export const metadata: Metadata = { title: "Sign in" }

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ mode?: string; reset?: string }> }) {
  const session = await getSession().catch(() => null)
  if (session) redirect("/modules/publishing/alt-text")
  const { mode, reset } = await searchParams
  const initialMode = mode === "signup" ? "signup" : mode === "forgot" ? "forgot" : "signin"

  return (
    <main className="flex min-h-dvh">
      <section className="hidden flex-1 flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
        <div className="flex items-center gap-2 text-sm font-medium">
          <BookOpen className="size-5" aria-hidden="true" />
          Muenot Services
        </div>
        <div className="flex max-w-md flex-col gap-4">
          <p className="text-3xl font-semibold leading-tight text-balance">Accessible images, written at publishing scale.</p>
          <p className="text-sm leading-relaxed text-primary-foreground/75 text-pretty">
            Upload manuscripts and image sets, generate review-ready alt text with AI, and export it straight back into your production workflow.
          </p>
        </div>
        <p className="text-xs text-primary-foreground/60">Internal workspace. Authorized staff only.</p>
      </section>
      <section className="flex flex-1 items-center justify-center p-6">
        <div className="flex w-full max-w-sm flex-col gap-8">
          <div className="flex items-center gap-2 text-sm font-medium lg:hidden">
            <BookOpen className="size-5 text-primary" aria-hidden="true" />
            Muenot Services
          </div>
          <AuthForm
            initialMode={initialMode}
            notice={reset === "1" ? "Your password was updated. Sign in with your new password." : undefined}
          />
        </div>
      </section>
    </main>
  )
}
