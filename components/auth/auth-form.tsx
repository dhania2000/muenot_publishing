"use client"
import { useActionState, useState } from "react"
import { AlertCircle } from "lucide-react"
import { signInAction, signUpAction, type AuthState } from "@/app/(auth)/actions"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"

type Mode = "signin" | "signup"

export function AuthForm({ initialMode }: { initialMode: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode)
  return mode === "signin" ? (
    <SignInForm key="signin" onSwitch={() => setMode("signup")} />
  ) : (
    <SignUpForm key="signup" onSwitch={() => setMode("signin")} />
  )
}

function FormError({ state }: { state: AuthState }) {
  if (!state?.error) return null
  return (
    <Alert variant="destructive" role="alert">
      <AlertCircle aria-hidden="true" />
      <AlertDescription>{state.error}</AlertDescription>
    </Alert>
  )
}

function SignInForm({ onSwitch }: { onSwitch: () => void }) {
  const [state, action, pending] = useActionState(signInAction, undefined)
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Sign in</h1>
        <p className="text-sm text-muted-foreground">Welcome back. Enter your credentials to continue.</p>
      </div>
      <FormError state={state} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state?.email} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? <Spinner /> : null}
        {pending ? "Signing in" : "Sign in"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {"New here? "}
        <button type="button" onClick={onSwitch} className="font-medium text-foreground underline-offset-4 hover:underline">
          Create an account
        </button>
      </p>
    </form>
  )
}

function SignUpForm({ onSwitch }: { onSwitch: () => void }) {
  const [state, action, pending] = useActionState(signUpAction, undefined)
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Create an account</h1>
        <p className="text-sm text-muted-foreground">The first account becomes the workspace administrator.</p>
      </div>
      <FormError state={state} />
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
        <button type="button" onClick={onSwitch} className="font-medium text-foreground underline-offset-4 hover:underline">
          Sign in
        </button>
      </p>
    </form>
  )
}
