/**
 * @file app/(workspace)/modules/publishing/page.tsx
 * @module Publishing
 * @kind Page (server component)
 * @summary /modules/publishing — guards access, then sends authorized users to Alt Text.
 */
import { redirect } from "next/navigation"
import { guardBusinessLine } from "@/components/business-line/business-line-landing"

export default async function PublishingPage() {
  await guardBusinessLine("publishing")
  redirect("/modules/publishing/alt-text")
}
