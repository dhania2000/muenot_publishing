import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import {
  CONVERSION_BASE_PATH,
  CONVERSION_SHARED_PAGES,
  conversionHref,
  modulesByCategory,
  type ConversionModule,
} from "@/lib/conversion-modules"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

export const PUBLISHING_CRUMBS = [
  { label: "Modules", href: "/modules" },
  { label: "Publishing", href: "/modules/publishing" },
]

const tabClass = (active: boolean) =>
  cn(
    "shrink-0 rounded-md px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "bg-secondary font-medium text-secondary-foreground"
      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
  )

function TabStrip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <nav aria-label={label} className="-mx-1 overflow-x-auto border-b pb-2">
      <ul className="flex gap-1 px-1">{children}</ul>
    </nav>
  )
}

export function ConversionSharedTabs({ activeSlug }: { activeSlug: string }) {
  return (
    <TabStrip label="Conversion pages">
      {CONVERSION_SHARED_PAGES.map(({ slug, label }) => (
        <li key={slug || "dashboard"}>
          <Link
            href={conversionHref(slug)}
            aria-current={slug === activeSlug ? "page" : undefined}
            className={tabClass(slug === activeSlug)}
          >
            {label}
          </Link>
        </li>
      ))}
    </TabStrip>
  )
}

export function ConversionModuleTabs({ module, activePage }: { module: ConversionModule; activePage: string }) {
  const tabs = [{ slug: "", label: "Overview" }, ...module.pages]
  return (
    <TabStrip label={`${module.label} pages`}>
      {tabs.map(({ slug, label }) => (
        <li key={slug || "overview"}>
          <Link
            href={conversionHref(module.slug, slug || undefined)}
            aria-current={slug === activePage ? "page" : undefined}
            className={tabClass(slug === activePage)}
          >
            {label}
          </Link>
        </li>
      ))}
    </TabStrip>
  )
}

export function ConversionServiceGrid() {
  return (
    <div className="flex flex-col gap-8">
      {modulesByCategory().map((category) => (
        <section key={category.id} aria-labelledby={`category-${category.id}`} className="flex flex-col gap-3">
          <h2 id={`category-${category.id}`} className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {category.label}
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {category.modules.map(({ slug, label, description, icon: ModuleIcon }) => (
              <li key={slug}>
                <Link
                  href={conversionHref(slug)}
                  className="group flex h-full flex-col gap-3 rounded-lg border bg-card p-5 text-card-foreground transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex size-10 items-center justify-center rounded-md bg-muted text-foreground">
                    <ModuleIcon className="size-5" aria-hidden="true" />
                  </span>
                  <span className="flex flex-col gap-1">
                    <span className="font-medium">{label}</span>
                    <span className="text-sm leading-relaxed text-muted-foreground">{description}</span>
                  </span>
                  <span className="mt-auto flex items-center gap-1 text-sm font-medium text-primary">
                    Open<span className="sr-only">{` ${label}`}</span>
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

export function PlannedPage({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export const CONVERSION_CRUMB = { label: "Conversion", href: CONVERSION_BASE_PATH }
