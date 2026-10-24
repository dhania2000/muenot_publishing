/**
 * @file app/(workspace)/modules/publishing/alt-text/page.tsx
 * @module Publishing
 * @kind Page (server component)
 * @summary AI Alt Text Writer at /modules/publishing/alt-text. On desktop the page is fitted
 *   to the viewport: a compact header, the five main tabs and one active workspace that owns
 *   its own scrolling. Smaller screens fall back to natural page scrolling.
 */
import type { Metadata } from "next"
import { guardBusinessLine } from "@/components/business-line/business-line-landing"
import { Breadcrumbs } from "@/components/enterprise/page-header"
import { AltTextWorkspace } from "@/components/publishing/alt-text/alt-text-workspace"

export const metadata: Metadata = {
  title: "AI Alt Text Writer",
  description: "Generate accurate, accessible image descriptions using artificial intelligence.",
}

export default async function AltTextPage() {
  const { Icon } = await guardBusinessLine("publishing", "publishing.view_alt_text")

  return (
    <div
      data-alt-text-layout
      className="mx-auto flex w-full min-w-0 max-w-[1600px] flex-col gap-3 bg-background p-4 lg:h-dvh lg:min-h-0 lg:px-6 lg:py-4"
    >
      <header className="flex shrink-0 flex-col gap-1.5">
        <Breadcrumbs
          items={[
            { label: "Modules", href: "/modules" },
            { label: "Publishing", href: "/modules/publishing" },
            { label: "Alt Text" },
          ]}
        />
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Icon className="size-4" aria-hidden="true" />
          </span>
          <div className="flex min-w-0 flex-col">
            <h1 className="truncate text-lg font-semibold leading-tight text-foreground">AI Alt Text Writer</h1>
            <p className="truncate text-xs text-muted-foreground">Generate accurate, accessible image descriptions using artificial intelligence.</p>
          </div>
        </div>
      </header>
      <AltTextWorkspace />
    </div>
  )
}
