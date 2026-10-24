import { CONVERSION_CATEGORIES, CONVERSION_MODULES, conversionHref } from "@/lib/conversion-modules"

export type NavIcon = "alt-text" | "conversion-name" | "users"

export type NavChild = {
  href: string
  label: string
  /** Optional sub-heading; consecutive children sharing a section render under one heading. */
  section?: string
}

export type NavItem = {
  href: string
  label: string
  icon: NavIcon
  children?: NavChild[]
}

export type NavMenuCategoryIcon =
  | "core-editing"
  | "specialist-editing"
  | "editorial-quality"
  | "publishing-support"
  | "document-accessibility"
  | "digital-accessibility"
  | "multimedia-accessibility"
  | "testing-compliance"
  | "accessibility-support"

/** A menu entry without an href is listed but not navigable until its page exists. */
export type NavMenuEntry = {
  label: string
  href?: string
}

export type NavMenuCategory = {
  id: string
  label: string
  icon: NavMenuCategoryIcon
  entries: NavMenuEntry[]
}

/** A non-navigating, expandable menu grouped into collapsible categories. */
export type NavMenu = {
  id: string
  label: string
  icon: "editorial-services" | "accessibility-services"
  categories: NavMenuCategory[]
}

export type NavGroup = {
  label: string
  items: NavItem[]
  /** Rendered after `items` within the same group. */
  menus?: NavMenu[]
  adminOnly?: boolean
}

export const EDITORIAL_SERVICES_MENU: NavMenu = {
  id: "editorial-services",
  label: "Editorial Services",
  icon: "editorial-services",
  categories: [
    {
      id: "core-editing",
      label: "Core Editing",
      icon: "core-editing",
      entries: [
        { label: "Pre Editing" },
        { label: "Style Editing" },
        { label: "Copy Editing" },
        { label: "Language Editing" },
        { label: "Proofreading" },
        { label: "Developmental Editing" },
      ],
    },
    {
      id: "specialist-editing",
      label: "Specialist Editing",
      icon: "specialist-editing",
      entries: [
        { label: "Subject Editing" },
        { label: "Technical Editing" },
        { label: "Reference Editing" },
        { label: "Fact Checking" },
        { label: "Manuscript Assessment" },
      ],
    },
    {
      id: "editorial-quality",
      label: "Editorial Quality",
      icon: "editorial-quality",
      entries: [
        { label: "Editorial QA" },
        { label: "Proof Collation" },
        { label: "Integrity Screening" },
        { label: "Manuscript Formatting" },
      ],
    },
    {
      id: "publishing-support",
      label: "Publishing Support",
      icon: "publishing-support",
      entries: [
        { label: "Indexing" },
        { label: "Content Updating" },
        { label: "Peer Review Support" },
        { label: "Rights & Permissions" },
      ],
    },
  ],
}

export const ACCESSIBILITY_SERVICES_MENU: NavMenu = {
  id: "accessibility-services",
  label: "Accessibility Services",
  icon: "accessibility-services",
  categories: [
    {
      id: "document-accessibility",
      label: "Document Accessibility",
      icon: "document-accessibility",
      entries: [
        { label: "PPT Accessibility" },
        { label: "PDF Accessibility" },
        { label: "Word Accessibility" },
        { label: "Excel Accessibility" },
        { label: "ePub Accessibility" },
      ],
    },
    {
      id: "digital-accessibility",
      label: "Digital Accessibility",
      icon: "digital-accessibility",
      entries: [
        { label: "Web Accessibility" },
        { label: "Mobile Accessibility" },
        { label: "LMS Accessibility" },
        { label: "eLearning Accessibility" },
        { label: "Forms Accessibility" },
        { label: "Math Accessibility" },
      ],
    },
    {
      id: "multimedia-accessibility",
      label: "Multimedia Accessibility",
      icon: "multimedia-accessibility",
      entries: [{ label: "Audio Accessibility" }, { label: "Video Accessibility" }],
    },
    {
      id: "testing-compliance",
      label: "Testing & Compliance",
      icon: "testing-compliance",
      entries: [{ label: "Testing" }, { label: "Remediation" }, { label: "Compliance Reports" }],
    },
    {
      id: "accessibility-support",
      label: "Accessibility Support",
      icon: "accessibility-support",
      entries: [
        { label: "Accessible Design" },
        { label: "Accessibility Consulting" },
        { label: "Accessibility Training" },
      ],
    },
  ],
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Publishing",
    items: [
      { href: "/modules/publishing/alt-text", label: "Alt Text", icon: "alt-text" },
      {
        href: "/modules/publishing/conversion-name",
        label: "Conversion",
        icon: "conversion-name",
        children: CONVERSION_CATEGORIES.flatMap((category) =>
          CONVERSION_MODULES.filter((module) => module.category === category.id).map(({ slug, label }) => ({
            href: conversionHref(slug),
            label,
            section: category.label,
          })),
        ),
      },
    ],
    menus: [EDITORIAL_SERVICES_MENU, ACCESSIBILITY_SERVICES_MENU],
  },
  {
    label: "Admin",
    adminOnly: true,
    items: [{ href: "/admin/users", label: "Users", icon: "users" }],
  },
]
