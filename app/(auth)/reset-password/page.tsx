import type { Metadata } from "next"
import { BookOpen } from "lucide-react"
import { ResetPasswordForm } from "@/components/auth/reset-password-form"

export const metadata: Metadata = { title: "Reset password", robots: { index: false } }

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-8">
        <div className="flex items-center gap-2 text-sm font-medium">
          <BookOpen className="size-5 text-primary" aria-hidden="true" />
          Muenot Publishing
        </div>
        <ResetPasswordForm token={typeof token === "string" ? token.slice(0, 200) : ""} />
      </div>
    </main>
  )
}
