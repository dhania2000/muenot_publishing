import { FileText } from "lucide-react"
import { PdfSectionPage } from "@/components/publishing/conversion/pdf/pdf-section-page"
import { PdfWorkspace } from "@/components/publishing/conversion/pdf/pdf-workspace"
import { PdfOverview } from "@/components/publishing/conversion/pdf/pdf-overview"
import { getConversionModule, getConversionPage } from "@/lib/conversion-modules"

export default async function Page({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params
  const mod = getConversionModule("pdf")!
  if (view === "overview")
    return (
      <PdfSectionPage module={mod} icon={FileText}>
        <PdfOverview module={mod} />
      </PdfSectionPage>
    )
  return (
    <PdfSectionPage module={mod} page={getConversionPage(mod, "workspace")!} icon={FileText}>
      <PdfWorkspace guidelinesHref={null} />
    </PdfSectionPage>
  )
}
