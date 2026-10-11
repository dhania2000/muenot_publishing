import * as React from "react"

/**
 * Bridges the Radix-style `asChild` prop onto Base UI's `render` prop so
 * existing call sites keep working against Base UI primitives.
 */
export function asChildProps(asChild: boolean | undefined, children: React.ReactNode) {
  if (asChild && React.isValidElement(children)) return { render: children as React.ReactElement }
  return { children }
}
