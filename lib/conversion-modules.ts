import { BookOpen, Code, Database, FileCode, FileText, FileType, type LucideIcon } from "lucide-react"

export const CONVERSION_BASE_PATH = "/modules/publishing/conversion-name"

export type ConversionModule = {
  slug: string
  label: string
  description: string
  icon: LucideIcon
}

export const CONVERSION_MODULES: ConversionModule[] = [
  {
    slug: "pdf",
    label: "PDF Conversion",
    description: "Convert source content into print-ready and accessible PDF files.",
    icon: FileText,
  },
  {
    slug: "xml",
    label: "XML Conversion",
    description: "Transform manuscripts into structured XML for downstream publishing.",
    icon: FileCode,
  },
  {
    slug: "epub",
    label: "ePub Conversion",
    description: "Produce reflowable and fixed-layout ePub files for e-readers.",
    icon: BookOpen,
  },
  {
    slug: "html",
    label: "HTML Conversion",
    description: "Generate clean, semantic HTML for web and digital delivery.",
    icon: Code,
  },
  {
    slug: "word",
    label: "Word Conversion",
    description: "Convert content to and from editable Word (DOCX) documents.",
    icon: FileType,
  },
  {
    slug: "lms-data-porting",
    label: "LMS Data Porting",
    description: "Port course content and data into learning management systems.",
    icon: Database,
  },
]

export function conversionHref(slug: string) {
  return `${CONVERSION_BASE_PATH}/${slug}`
}

export function getConversionModule(slug: string) {
  return CONVERSION_MODULES.find((module) => module.slug === slug)
}
