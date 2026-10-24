import {
  Accessibility,
  Archive,
  ArrowRightLeft,
  BookOpen,
  Braces,
  Captions,
  Code,
  Database,
  FileCode,
  FileText,
  FileType,
  GraduationCap,
  History,
  ImageIcon,
  Languages,
  LayoutTemplate,
  ListChecks,
  MousePointerClick,
  Package,
  Presentation,
  Printer,
  ScanText,
  Sheet,
  Sigma,
  Sparkles,
  Tablet,
  Tags,
  type LucideIcon,
} from "lucide-react"

export const CONVERSION_BASE_PATH = "/modules/publishing/conversion-name"

export type ConversionCategoryId =
  | "document-office"
  | "digital-publishing"
  | "ocr-archives"
  | "learning-assessment"
  | "accessibility-media"
  | "data-migration"

export type ConversionCategory = { id: ConversionCategoryId; label: string }

export const CONVERSION_CATEGORIES: ConversionCategory[] = [
  { id: "document-office", label: "Document & Office" },
  { id: "digital-publishing", label: "Digital Publishing" },
  { id: "ocr-archives", label: "OCR & Archives" },
  { id: "learning-assessment", label: "Learning & Assessment" },
  { id: "accessibility-media", label: "Accessibility & Media" },
  { id: "data-migration", label: "Data & Migration" },
]

export type ConversionPage = { slug: string; label: string }

export type ConversionModule = {
  slug: string
  label: string
  description: string
  icon: LucideIcon
  category: ConversionCategoryId
  /** Internal pages after Overview, in display order. Overview is the module root. */
  pages: ConversionPage[]
}

function slugify(label: string) {
  return label
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

function pages(...labels: string[]): ConversionPage[] {
  return labels.map((label) => ({ slug: slugify(label), label }))
}

export const CONVERSION_MODULES: ConversionModule[] = [
  {
    slug: "pdf",
    label: "PDF",
    description: "Convert source content into print-ready and accessible PDF files.",
    icon: FileText,
    category: "document-office",
    pages: pages(
      "Workspace",
      "Output Settings",
      "Page Layout",
      "Content Extraction",
      "Compliance Profiles",
      "Preflight & Validation",
      "Batch Processing",
      "Output Preview",
      "History",
    ),
  },
  {
    slug: "word",
    label: "Word",
    description: "Convert content to and from editable Word (DOCX) documents.",
    icon: FileType,
    category: "document-office",
    pages: pages(
      "Workspace",
      "Style Mapping",
      "Templates",
      "Tables & Equations",
      "Reference Validation",
      "Output Preview",
      "Batch Processing",
      "History",
    ),
  },
  {
    slug: "powerpoint",
    label: "PowerPoint",
    description: "Extract and restructure slide decks into publishable content.",
    icon: Presentation,
    category: "document-office",
    pages: pages(
      "Workspace",
      "Slide Extraction",
      "Content Mapping",
      "Theme Mapping",
      "Batch Processing",
      "Slide Preview",
      "Slide Validation",
      "History",
    ),
  },
  {
    slug: "spreadsheets",
    label: "Spreadsheets",
    description: "Transform spreadsheet data into structured, validated outputs.",
    icon: Sheet,
    category: "document-office",
    pages: pages(
      "Workspace",
      "Column Mapping",
      "Sheet Selection",
      "Data Transformation",
      "Formula Checks",
      "Data Validation",
      "Output Preview",
      "History",
    ),
  },
  {
    slug: "xml",
    label: "XML",
    description: "Transform manuscripts into structured XML for downstream publishing.",
    icon: FileCode,
    category: "digital-publishing",
    pages: pages(
      "Workspace",
      "Schema Profiles",
      "Schema Validation",
      "XML Mapping",
      "XSLT Rules",
      "Reference Mapping",
      "Structure Preview",
      "Error Reports",
      "History",
    ),
  },
  {
    slug: "epub",
    label: "ePub",
    description: "Produce reflowable and fixed-layout ePub files for e-readers.",
    icon: BookOpen,
    category: "digital-publishing",
    pages: pages(
      "Workspace",
      "Layout Settings",
      "TOC Editor",
      "CSS Profiles",
      "Media Manager",
      "Metadata",
      "Accessibility Checks",
      "ePub Validation",
      "Reader Preview",
      "History",
    ),
  },
  {
    slug: "ebook-kindle",
    label: "eBook & Kindle",
    description: "Package eBooks for Kindle and other retailer storefronts.",
    icon: Tablet,
    category: "digital-publishing",
    pages: pages(
      "Workspace",
      "Format Profiles",
      "Retailer Settings",
      "Cover & Metadata",
      "Package Validation",
      "Device Preview",
      "Batch Processing",
      "History",
    ),
  },
  {
    slug: "html",
    label: "HTML",
    description: "Generate clean, semantic HTML for web and digital delivery.",
    icon: Code,
    category: "digital-publishing",
    pages: pages(
      "Workspace",
      "HTML/CSS Rules",
      "Structure Mapping",
      "Responsive Preview",
      "Link Validation",
      "Browser Checks",
      "Batch Processing",
      "History",
    ),
  },
  {
    slug: "dtp-files",
    label: "DTP Files",
    description: "Convert InDesign, QuarkXPress and other desktop publishing packages.",
    icon: LayoutTemplate,
    category: "digital-publishing",
    pages: pages(
      "Workspace",
      "Package Inspection",
      "Style Mapping",
      "Page Layout",
      "Linked Assets",
      "Fidelity Review",
      "Preflight Reports",
      "History",
    ),
  },
  {
    slug: "print-digitization",
    label: "Print Digitization",
    description: "Reconstruct printed titles as structured digital editions.",
    icon: Printer,
    category: "digital-publishing",
    pages: pages(
      "Workspace",
      "Source Assessment",
      "Scan Management",
      "Structure Mapping",
      "Digital Reconstruction",
      "Pagination Checks",
      "Output Preview",
      "History",
    ),
  },
  {
    slug: "scientific-math",
    label: "Scientific & Math",
    description: "Convert equations, formulas and scientific notation accurately.",
    icon: Sigma,
    category: "digital-publishing",
    pages: pages(
      "Workspace",
      "Equation Extraction",
      "Formula Editor",
      "Math Preview",
      "Symbol Validation",
      "Tables & Figures",
      "Accuracy Review",
      "History",
    ),
  },
  {
    slug: "ocr-scanning",
    label: "OCR & Scanning",
    description: "Recognize text and layout from scanned pages and images.",
    icon: ScanText,
    category: "ocr-archives",
    pages: pages(
      "Workspace",
      "OCR Profiles",
      "Page Segmentation",
      "Text Correction",
      "Layout Recognition",
      "Confidence Review",
      "Quality Dashboard",
      "Batch Processing",
      "History",
    ),
  },
  {
    slug: "digital-archives",
    label: "Digital Archives",
    description: "Prepare collections for long-term digital preservation.",
    icon: Archive,
    category: "ocr-archives",
    pages: pages(
      "Workspace",
      "Batch Inventory",
      "Collection Mapping",
      "Preservation Profiles",
      "Archive Metadata",
      "Integrity Checks",
      "Export Packages",
      "History",
    ),
  },
  {
    slug: "images-graphics",
    label: "Images & Graphics",
    description: "Convert, resample and optimize images and graphic assets.",
    icon: ImageIcon,
    category: "ocr-archives",
    pages: pages(
      "Workspace",
      "Batch Processing",
      "Format Profiles",
      "Color & DPI",
      "Quality Comparison",
      "Asset Export",
      "History",
    ),
  },
  {
    slug: "lms-data-porting",
    label: "LMS Porting",
    description: "Port course content and data into learning management systems.",
    icon: Database,
    category: "learning-assessment",
    pages: pages(
      "Workspace",
      "Source LMS",
      "Target LMS",
      "Course Mapping",
      "Data Mapping",
      "Batch Management",
      "Migration Trial",
      "Migration Validation",
      "Reconciliation Reports",
      "History",
    ),
  },
  {
    slug: "learning-standards",
    label: "Learning Standards",
    description: "Package content for SCORM, xAPI, cmi5 and other e-learning standards.",
    icon: GraduationCap,
    category: "learning-assessment",
    pages: pages(
      "Workspace",
      "Standards Mapping",
      "Package Editor",
      "Object Mapping",
      "Tracking Rules",
      "Package Validation",
      "Compatibility Testing",
      "Package Export",
      "History",
    ),
  },
  {
    slug: "question-banks",
    label: "Question Banks",
    description: "Convert assessment items into QTI and platform-ready question banks.",
    icon: ListChecks,
    category: "learning-assessment",
    pages: pages(
      "Workspace",
      "Question Extraction",
      "Question Mapping",
      "Question Editor",
      "Answer Mapping",
      "Equation Processing",
      "Export Settings",
      "Question Validation",
      "Package Manager",
      "History",
    ),
  },
  {
    slug: "interactive-learning",
    label: "Interactive Learning",
    description: "Rebuild legacy interactives as responsive HTML5 experiences.",
    icon: MousePointerClick,
    category: "learning-assessment",
    pages: pages(
      "Workspace",
      "Interaction Inventory",
      "Media Mapping",
      "Interaction Mapping",
      "Responsive Preview",
      "Interaction Validation",
      "Device Testing",
      "History",
    ),
  },
  {
    slug: "accessible-formats",
    label: "Accessible Formats",
    description: "Produce DAISY, braille-ready and other accessible editions.",
    icon: Accessibility,
    category: "accessibility-media",
    pages: pages(
      "Workspace",
      "Format Profiles",
      "Reading Order",
      "Alternative Mapping",
      "Format Validation",
      "Output Preview",
      "Final Review",
      "History",
    ),
  },
  {
    slug: "media-captions",
    label: "Media & Captions",
    description: "Convert audio, video and caption files for publishing delivery.",
    icon: Captions,
    category: "accessibility-media",
    pages: pages(
      "Workspace",
      "Media Profiles",
      "Caption Import",
      "Timeline Mapping",
      "Processing Queue",
      "Media Preview",
      "Media QA",
      "History",
    ),
  },
  {
    slug: "publishing-metadata",
    label: "Publishing Metadata",
    description: "Map and convert ONIX, MARC and other bibliographic metadata.",
    icon: Tags,
    category: "data-migration",
    pages: pages(
      "Workspace",
      "Schema Registry",
      "Field Mapping",
      "Vocabulary Mapping",
      "Identifier Checks",
      "Metadata Comparison",
      "Metadata Export",
      "History",
    ),
  },
  {
    slug: "structured-data",
    label: "Structured Data",
    description: "Transform JSON, CSV and database records between schemas.",
    icon: Braces,
    category: "data-migration",
    pages: pages(
      "Workspace",
      "Source Settings",
      "Schema Mapping",
      "Transformation Rules",
      "Data Preview",
      "Record Validation",
      "Batch Processing",
      "Error Management",
      "History",
    ),
  },
  {
    slug: "cms-migration",
    label: "CMS Migration",
    description: "Migrate content, taxonomies and assets between CMS platforms.",
    icon: ArrowRightLeft,
    category: "data-migration",
    pages: pages(
      "Workspace",
      "Platform Mapping",
      "Field Mapping",
      "Taxonomy Mapping",
      "Asset Mapping",
      "URL Mapping",
      "Migration Trial",
      "Post-Migration Checks",
      "History",
    ),
  },
  {
    slug: "legacy-formats",
    label: "Legacy Formats",
    description: "Recover content from obsolete and proprietary file formats.",
    icon: History,
    category: "data-migration",
    pages: pages(
      "Format Assessment",
      "Compatibility Checks",
      "Recovery Profiles",
      "Workspace",
      "Batch Processing",
      "Integrity Reports",
      "History",
    ),
  },
  {
    slug: "ai-ready-content",
    label: "AI-Ready Content",
    description: "Prepare clean, chunked and enriched content for AI pipelines.",
    icon: Sparkles,
    category: "data-migration",
    pages: pages(
      "Workspace",
      "Content Extraction",
      "Chunking Rules",
      "Metadata Enrichment",
      "Sensitive Data",
      "Schema Validation",
      "Export Packages",
      "History",
    ),
  },
  {
    slug: "localization-files",
    label: "Localization Files",
    description: "Convert XLIFF and translation files while preserving markup.",
    icon: Languages,
    category: "data-migration",
    pages: pages(
      "Workspace",
      "Language Metadata",
      "File Mapping",
      "Tag Preservation",
      "Encoding & RTL",
      "Package Export",
      "History",
    ),
  },
]

export type ConversionSharedPage = { slug: string; label: string; description: string }

/** Module-level pages. `slug: ""` is the Conversion root (Dashboard). */
export const CONVERSION_SHARED_PAGES: ConversionSharedPage[] = [
  { slug: "", label: "Dashboard", description: "Overview of conversion services and activity." },
  { slug: "services", label: "All Services", description: "Browse every conversion service by category." },
  { slug: "jobs", label: "All Jobs", description: "Track conversion jobs across every service." },
  { slug: "batch-center", label: "Batch Center", description: "Run and monitor multi-file conversion batches." },
  { slug: "file-manager", label: "File Manager", description: "Upload, organize and manage source files." },
  { slug: "profiles-presets", label: "Profiles & Presets", description: "Reusable conversion profiles and presets." },
  { slug: "format-library", label: "Format Library", description: "Reference library of supported formats and schemas." },
  { slug: "qa-center", label: "QA Center", description: "Quality assurance and validation across conversions." },
  { slug: "history", label: "History", description: "Audit trail of completed conversions." },
  { slug: "downloads", label: "Downloads", description: "Download converted output files." },
  { slug: "reports", label: "Reports", description: "Conversion throughput and quality reports." },
  { slug: "settings", label: "Settings", description: "Configure conversion module defaults." },
]

export function conversionHref(slug: string, page?: string) {
  const base = slug ? `${CONVERSION_BASE_PATH}/${slug}` : CONVERSION_BASE_PATH
  return page ? `${base}/${page}` : base
}

export function getConversionModule(slug: string) {
  return CONVERSION_MODULES.find((module) => module.slug === slug)
}

export function getConversionPage(module: ConversionModule, pageSlug: string) {
  return module.pages.find((page) => page.slug === pageSlug)
}

export function getSharedPage(slug: string) {
  return CONVERSION_SHARED_PAGES.find((page) => page.slug === slug)
}

export function modulesByCategory() {
  return CONVERSION_CATEGORIES.map((category) => ({
    ...category,
    modules: CONVERSION_MODULES.filter((module) => module.category === category.id),
  }))
}
