"use client"
import Link from "next/link"
import { useActionState } from "react"
import { ArrowLeft } from "lucide-react"
import { resetPasswordAction } from "@/app/(auth)/actions"
import { FormError } from "@/components/auth/auth-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, undefined)
  const missing = !token
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Set a new password</h1>
        <p className="text-sm text-muted-foreground">You&apos;ll be signed out of all devices after the change.</p>
      </div>
      <FormError error={missing ? "This reset link is invalid. Request a new one from the sign-in page." : state?.error} />
      <input type="hidden" name="token" value={token} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">New password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required aria-describedby="password-hint" disabled={missing} />
        <p id="password-hint" className="text-xs text-muted-foreground">At least 8 characters.</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm">Confirm new password</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} required disabled={missing} />
      </div>
      <Button type="submit" disabled={pending || missing} className="w-full">
        {pending ? <Spinner /> : null}
        {pending ? "Updating password" : "Update password"}
      </Button>
      <Link href="/login" className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to sign in
      </Link>
    </form>
  )
}
