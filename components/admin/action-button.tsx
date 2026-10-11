"use client"
import { useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

type Props = {
  action: () => Promise<void>
  label: string
  pendingLabel: string
  confirm?: string
  variant?: "default" | "outline" | "ghost"
  "aria-label"?: string
}

export function ActionButton({ action, label, pendingLabel, confirm, variant = "default", ...rest }: Props) {
  const [pending, startTransition] = useTransition()
  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      disabled={pending}
      aria-label={rest["aria-label"]}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return
        startTransition(() => action())
      }}
    >
      {pending ? <Spinner /> : null}
      {pending ? pendingLabel : label}
    </Button>
  )
}
