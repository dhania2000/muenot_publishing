"use client"
import { useActionState, useState } from "react"
import { AlertCircle, ArrowLeft, CheckCircle2 } from "lucide-react"
import { requestPasswordResetAction, signInAction, signUpAction } from "@/app/(auth)/actions"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"

type Mode = "signin" | "signup" | "forgot"

export function AuthForm({ initialMode, notice }: { initialMode: Mode; notice?: string }) {
  const [mode, setMode] = useState<Mode>(initialMode)
  if (mode === "signup") return <SignUpForm key="signup" onSwitch={() => setMode("signin")} />
  if (mode === "forgot") return <ForgotPasswordForm key="forgot" onBack={() => setMode("signin")} />
  return <SignInForm key="signin" notice={notice} onSwitch={() => setMode("signup")} onForgot={() => setMode("forgot")} />
}

export function FormError({ error }: { error?: string }) {
  if (!error) return null
  return (
    <Alert variant="destructive" role="alert">
      <AlertCircle aria-hidden="true" />
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  )
}

function FormNotice({ message }: { message?: string }) {
  if (!message) return null
  return (
    <Alert role="status">
      <CheckCircle2 aria-hidden="true" />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

const linkButton = "font-medium text-foreground underline-offset-4 hover:underline"

function SignInForm({ notice, onSwitch, onForgot }: { notice?: string; onSwitch: () => void; onForgot: () => void }) {
  const [state, action, pending] = useActionState(signInAction, undefined)
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Sign in</h1>
        <p className="text-sm text-muted-foreground">Welcome back. Enter your credentials to continue.</p>
      </div>
      {state?.error ? <FormError error={state.error} /> : <FormNotice message={notice} />}
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state?.email} />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <button type="button" onClick={onForgot} className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            Forgot password?
          </button>
        </div>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? <Spinner /> : null}
        {pending ? "Signing in" : "Sign in"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {"New here? "}
        <button type="button" onClick={onSwitch} className={linkButton}>
          Create an account
        </button>
      </p>
    </form>
  )
}

function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const [state, action, pending] = useActionState(requestPasswordResetAction, undefined)
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Reset your password</h1>
        <p className="text-sm text-muted-foreground text-pretty">
          Enter your account email and we&apos;ll send you a link to set a new password.
        </p>
      </div>
      <FormError error={state?.error} />
      {state?.sent ? (
        <FormNotice message={`If an account exists for ${state.email}, a reset link is on its way. It expires in 30 minutes.`} />
      ) : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state?.email} />
      </div>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? <Spinner /> : null}
        {pending ? "Sending link" : state?.sent ? "Send again" : "Send reset link"}
      </Button>
      <button type="button" onClick={onBack} className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to sign in
      </button>
    </form>
  )
}

function SignUpForm({ onSwitch }: { onSwitch: () => void }) {
  const [state, action, pending] = useActionState(signUpAction, undefined)
  if (state?.pending) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">Account created</h1>
          <p className="text-sm text-muted-foreground">One more step before you can sign in.</p>
        </div>
        <Alert>
          <CheckCircle2 aria-hidden="true" />
          <AlertDescription>
            {`Your account for ${state.email} is awaiting administrator approval. You'll be able to sign in once it's approved.`}
          </AlertDescription>
        </Alert>
        <Button type="button" variant="outline" onClick={onSwitch} className="w-full">
          Back to sign in
        </Button>
      </div>
    )
  }
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Create an account</h1>
        <p className="text-sm text-muted-foreground">New accounts need administrator approval before signing in.</p>
      </div>
      <FormError error={state?.error} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Full name</Label>
        <Input id="name" name="name" autoComplete="name" required defaultValue={state?.name} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state?.email} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required aria-describedby="password-hint" />
        <p id="password-hint" className="text-xs text-muted-foreground">At least 8 characters.</p>
      </div>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? <Spinner /> : null}
        {pending ? "Creating account" : "Create account"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {"Already have an account? "}
        <button type="button" onClick={onSwitch} className={linkButton}>
          Sign in
        </button>
      </p>
    </form>
  )
}
