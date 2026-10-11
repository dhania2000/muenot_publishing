/**
 * @file lib/workspace-nav.tsx
 * @module Workspace Shell
 * @kind React component
 * @summary Workspace Shell UI: ADMINISTRATION_CHILDREN, AUTOMATION_CHILDREN, SECURITY_CHILDREN, DEVELOPER_CHILDREN.
 * @exports ADMINISTRATION_CHILDREN, AUTOMATION_CHILDREN, SECURITY_CHILDREN, DEVELOPER_CHILDREN, GOVERNANCE_CHILDREN, BILLING_CHILDREN, buildWorkspaceNav
 * @usedBy app/(workspace)/layout.tsx, app/admin/layout.tsx
 * @see docs/CODEBASE-GUIDE.md for module ownership, conventions and where to add new code.
 */
import type { NavItem, NavChild } from "@/components/app-shell"
import { getUserAccessibleModules, getFeatureChecker, getEntity360Checker, getDashboardChecker } from "@/lib/permissions"
import type { Entity360View } from "@/lib/permission-model"
import type { SessionPayload } from "@/lib/auth"
import {
  Users2,
  TrendingUp,
  Wallet,
  UserPlus,
  Settings2,
  ShieldCheck,
  BriefcaseBusiness,
  TicketCheck,
  Package,
  Scale,
  ExternalLink,
  Megaphone,
  MessageCircle,
  LayoutDashboard,
  CreditCard,
  ListChecks,
  DoorOpen,
  CalendarDays,
  MessagesSquare,
  PhoneCall,
  Orbit,
  BookOpen,
  GraduationCap,
  Headset,
  Code2,
} from "lucide-react"
import type { ModuleGate } from "@/lib/workspace/module-gating"
import { loadModuleGate } from "@/lib/workspace/module-marketplace-store"
import { Server as ServerIcon, History as HistoryIcon, MonitorCog, Building2, Workflow } from "lucide-react"
import { getAccessChecker } from "@/lib/access-control/server"
import { buildItNavChildren, IT_BASE } from "@/lib/it/config"
import { ownsGlobalErpLedger } from "@/lib/global-erp-scope"
import { currentTenantIdOrNull } from "@/lib/tenant-scope"
import { getTenantEntitlements } from "@/lib/platform/entitlement-guard"
import { hasAiInterviewerEntitlement } from "@/lib/recruitment/ai-interview/premium"

function settingEnabled(v: string | undefined, fallback = true) {
  if (v == null) return fallback
  const t = v.trim().toLowerCase()
  return t === "enabled" || t === "true" || t === "1" || t === "yes"
}

const moduleIcons: Record<string, NavItem["icon"]> = {
  hr: <Users2 className="size-4" />,
  sales: <TrendingUp className="size-4" />,
  finance: <Wallet className="size-4" />,
  recruitment: <UserPlus className="size-4" />,
  operations: <Settings2 className="size-4" />,
  clients: <BriefcaseBusiness className="size-4" />,
  tickets: <TicketCheck className="size-4" />,
  products: <Package className="size-4" />,
  legal: <Scale className="size-4" />,
  marketing: <Megaphone className="size-4" />,
  calendar: <CalendarDays className="size-4" />,
  messages: <MessagesSquare className="size-4" />,
}

type FeatureChild = { label: string; href?: string; feature?: string; view360?: Entity360View; premiumAiInterview?: boolean; children?: FeatureChild[] }

// Marketing sub-pages shown in the sidebar dropdown. The Marketing module is
// not stored in the `modules` table, so it is injected into the sidebar
// directly below, but each child is gated by a permission-matrix feature slug
// (resolved onto the Marketing permission modules) just like every other module.
const MARKETING_CHILDREN: FeatureChild[] = [
  { label: "Dashboard", href: "/modules/marketing/dashboard", feature: "marketing.view_dashboard" },
  { label: "Contacts", href: "/modules/marketing/contacts", feature: "marketing.view_contacts" },
  { label: "Lead Generation", href: "/modules/marketing/lead-generation", feature: "marketing.view_lead_generation" },
  { label: "Journeys", href: "/modules/marketing/journeys", feature: "marketing.view_journeys" },
  { label: "Marketing Planner", href: "/modules/marketing/planner", feature: "marketing.view_planner" },
  {
    label: "Marketing Campaigns",
    children: [
      { label: "Overview", href: "/modules/marketing/campaigns", feature: "marketing.view_campaigns" },
      { label: "Email", href: "/modules/marketing/campaigns/email", feature: "marketing.view_email_campaigns" },
      { label: "Social", href: "/modules/marketing/campaigns/social", feature: "marketing.view_social_campaigns" },
    ],
  },
  { label: "Website Analytics", href: "/modules/marketing/website-analytics", feature: "marketing.view_website_analytics" },
  { label: "Library", href: "/modules/marketing/library", feature: "marketing.view_library" },
]

// HR sidebar organised as an HCM/HRIS hierarchy. Only labels and grouping are
// display concerns here: every leaf keeps its original route and feature slug.
// Training and Policies now have their own permission rows (hr.training,
// hr.policies) in the role matrix. /jml is not
// exposed in the sidebar.
// /modules/hr/letters/generate is reached via the "Create letter" action on
// the Letters page rather than as a standalone destination.
const HR_CHILDREN: FeatureChild[] = [
  { label: "Overview", href: "/modules/hr/dashboard", feature: "hr.view_dashboard" },
  {
    label: "People",
    children: [
      { label: "Employees", href: "/modules/hr/employees", feature: "hr.view_employees" },
      { label: "Employee Documents", href: "/modules/hr/employee-documents", feature: "hr.view_documents" },
      { label: "Offboarding", href: "/modules/hr/offboarding", feature: "hr.view_offboarding" },
    ],
  },
  {
    label: "Time & Attendance",
    children: [
      { label: "Attendance", href: "/modules/hr/attendance", feature: "hr.view_attendance" },
      { label: "Attendance Corrections", href: "/modules/hr/attendance-regularisation", feature: "hr.view_regularisation" },
  { label: "Biometric Devices", href: "/modules/hr/biometric", feature: "hr.view_biometric" },
      { label: "Screen Monitoring", href: "/modules/hr/screen-monitoring", feature: "hr.view_screen_monitoring" },
      {
        label: "Shift Management",
        children: [
          { label: "Shift Setup", href: "/modules/hr/shifts", feature: "hr.view_shifts" },
          { label: "Shift Change Requests", href: "/modules/hr/shift-change-requests", feature: "hr.view_shift_change_requests" },
          { label: "Shift Assignments", href: "/modules/hr/shift-workflows?kind=assignments", feature: "hr.view_shift_assignments" },
          { label: "Shift Rotations", href: "/modules/hr/shift-rotations", feature: "hr.view_shift_rotations" },
          { label: "Rotation Sequences", href: "/modules/hr/shift-workflows?kind=sequences", feature: "hr.view_rotation_sequences" },
          { label: "Rotation Members", href: "/modules/hr/shift-workflows?kind=employees", feature: "hr.view_rotation_employees" },
        ],
      },
    ],
  },
  {
    label: "Leave Management",
    children: [
      { label: "Leave Requests", href: "/modules/hr/leave-requests", feature: "hr.view_leave_requests" },
      { label: "Leave Balances", href: "/modules/hr/leave-balances", feature: "hr.view_leave_balances" },
      { label: "Leave Entitlement History", href: "/modules/hr/leave-quota-history", feature: "hr.view_leave_quota_history" },
      { label: "Leave Types", href: "/modules/hr/leave-types", feature: "hr.view_leave_types" },
    ],
  },
  {
    label: "Performance & Development",
    children: [
      { label: "Performance Management", href: "/modules/hr/performance", feature: "hr.view_performance" },
      { label: "Goals & KPIs", href: "/modules/hr/goals-kpi", feature: "hr.view_goals_kpi" },
      { label: "Training Management", href: "/modules/hr/training", feature: "hr.view_training" },
      { label: "Promotions", href: "/modules/hr/promotions", feature: "hr.view_promotions" },
      { label: "Awards & Recognition", href: "/modules/hr/awards-recognition", feature: "hr.view_awards" },
    ],
  },
  {
    label: "Payroll & Claims",
    children: [
      { label: "Payroll", href: "/modules/hr/payroll", feature: "hr.view_payroll" },
      { label: "Expense Claims", href: "/modules/hr/expense-claims", feature: "hr.view_expense_claims" },
    ],
  },
  {
    label: "HR Services",
    children: [
      { label: "HR Helpdesk", href: "/modules/hr/support", feature: "hr.view_support" },
      { label: "Passport & Visa", href: "/modules/hr/passport-visa", feature: "hr.view_passport_visa" },
      { label: "Policies", href: "/modules/hr/policies", feature: "hr.view_policies" },
      {
        label: "HR Communications",
        children: [
          { label: "HR Emails", href: "/modules/hr/emails", feature: "hr.view_emails" },
          { label: "Email Templates", href: "/modules/hr/email-templates", feature: "hr.view_email_templates" },
        ],
      },
      {
        label: "Letters & Documents",
        children: [
          { label: "Letters", href: "/modules/hr/letters", feature: "hr.view_letters" },
          { label: "Letter Templates", href: "/modules/hr/letter-templates", feature: "hr.view_letter_templates" },
        ],
      },
    ],
  },
  {
    label: "HR Setup",
    children: [
      { label: "Departments", href: "/modules/hr/departments", feature: "hr.view_departments" },
      { label: "Designations", href: "/modules/hr/designations", feature: "hr.view_designations" },
      { label: "Document Types", href: "/modules/hr/document-types", feature: "hr.view_document_types" },
      { label: "Holiday Calendar", href: "/modules/hr/holidays", feature: "hr.view_holidays" },
    ],
  },
]

// Finance sidebar organised by the finance operating model. Every leaf keeps its
// original route and permission slug. Legal Entities, Multi-Currency and Fiscal
// Year are intentionally owned by Administration and not duplicated here.
const FINANCE_CHILDREN: FeatureChild[] = [
  { label: "Overview", href: "/modules/finance", feature: "finance.view_dashboard" },
  {
    label: "Billing & Receivables",
    children: [
      { label: "Sales Invoices", href: "/modules/finance/sales-invoices", feature: "finance.view_sales_invoices" },
    ],
  },
  {
    label: "Payables & Expenses",
    children: [
      { label: "Purchase Bills", href: "/modules/finance/purchase-bills", feature: "finance.view_purchase_bills" },
      { label: "Expenses", href: "/modules/finance/expenses", feature: "finance.view_expenses" },
      { label: "Expense Approvals", href: "/modules/finance/expense-approvals", feature: "finance.view_expenses" },
      {
        label: "Workforce Payables",
        children: [
          { label: "FTE Invoices", href: "/modules/finance/fte-invoices", feature: "finance.view_fte_invoices" },
          { label: "Freelance Invoices", href: "/modules/finance/freelance-invoices", feature: "finance.view_freelance_invoices" },
        ],
      },
    ],
  },
  {
    label: "Procurement & Vendors",
    children: [
      { label: "Procurement Overview", href: "/modules/finance/procurement", feature: "finance.view_procurement" },
      { label: "Vendors", href: "/modules/finance/customers-vendors", feature: "finance.view_customers_vendors" },
      { label: "Purchase Requisition", href: "/modules/finance/purchase-requisition", feature: "finance.view_purchase_requisition" },
      { label: "RFQ Management", href: "/modules/finance/rfq", feature: "finance.view_rfq" },
      { label: "Purchase Orders", href: "/modules/finance/purchase-orders", feature: "finance.view_purchase_orders" },
      { label: "Three-Way Match", href: "/modules/finance/three-way-match", feature: "finance.view_three_way_match" },
      { label: "Procurement Approvals", href: "/modules/finance/procurement-approvals", feature: "finance.view_procurement_approvals" },
    ],
  },
  {
    label: "Cash & Treasury",
    children: [
      { label: "Bank & Cash Accounts", href: "/modules/finance/bank-cash", feature: "finance.view_bank_cash" },
      { label: "Bank Transactions", href: "/modules/finance/bank-transactions", feature: "finance.view_bank_transactions" },
      { label: "Loans & Advances", href: "/modules/finance/loans-advances", feature: "finance.view_loans_advances" },
      { label: "Investments", href: "/modules/finance/investments", feature: "finance.view_investments" },
    ],
  },
  {
    label: "Accounting & Close",
    children: [
      { label: "Chart of Accounts", href: "/modules/finance/chart-of-accounts", feature: "finance.view_chart_of_accounts" },
      { label: "Journal Entries", href: "/modules/finance/journal-entries", feature: "finance.journal_entries" },
      { label: "General Ledger", href: "/modules/finance/general-ledger", feature: "finance.general_ledger" },
      { label: "Fixed Assets", href: "/modules/finance/fixed-assets", feature: "finance.view_fixed_assets" },
      { label: "Provisions & Accruals", href: "/modules/finance/provisions-accruals", feature: "finance.view_provisions_accruals" },
      { label: "Capital & Equity", href: "/modules/finance/capital-equity", feature: "finance.view_capital_equity" },
      { label: "Related Parties", href: "/modules/finance/related-parties", feature: "finance.view_related_parties" },
      { label: "Period Lock", href: "/modules/finance/period-lock", feature: "finance.view_period_lock" },
      { label: "Core Integration", href: "/modules/finance/core-integration", feature: "finance.view_core_integration" },
    ],
  },
  {
    label: "Planning & Reporting",
    children: [
      { label: "Budget Management", href: "/modules/finance/budgets", feature: "finance.view_budgets" },
      { label: "Financial Reports", href: "/modules/finance/financial-reports", feature: "finance.financial_reports" },
    ],
  },
  {
    label: "Tax & Compliance",
    children: [
      { label: "GST Filing", href: "/modules/finance/gst-filing", feature: "finance.gst_filing" },
      { label: "TDS Filing", href: "/modules/finance/tds-filing", feature: "finance.tds_filing" },
    ],
  },
  {
    label: "Communications",
    children: [
      { label: "Finance Emails", href: "/modules/finance/emails", feature: "finance.send_emails" },
      { label: "Email Templates", href: "/modules/finance/email-templates", feature: "finance.view_email_templates" },
    ],
  },
]

// Recruitment sidebar organised as a hierarchical ERP structure. Parent groups
// are collapsible; every leaf keeps its original route and permission slug so
// existing pages, URLs and permissions are preserved. "Candidate Master" is
// intentionally omitted — Candidate Database is the single candidate registry
// and Candidate 360 opens the unified profile from it.
const RECRUITMENT_CHILDREN: FeatureChild[] = [
  {
    label: "Dashboard",
    children: [
      { label: "Recruit Dashboard", href: "/modules/recruitment", feature: "recruitment.view_dashboard" },
    ],
  },
  {
    label: "Hiring",
    children: [
      { label: "Requisition Hiring", href: "/modules/recruitment/requisition-hiring", feature: "recruitment.requisitions" },
      { label: "Job Requisitions", href: "/modules/recruitment/job-requisitions", feature: "recruitment.requisitions" },
      { label: "Jobs", href: "/modules/recruitment/jobs", feature: "recruitment.view_jobs" },
      { label: "Job Skills", href: "/modules/recruitment/job-skills", feature: "recruitment.view_skills" },
      { label: "Recruitment Sources", href: "/modules/recruitment/recruitment-sources", feature: "recruitment.candidates" },
      { label: "Recruitment Campaigns", href: "/modules/recruitment/recruitment-campaigns", feature: "recruitment.requisitions" },
    ],
  },
  {
    label: "Candidates",
    children: [
      { label: "Candidate Database", href: "/modules/recruitment/candidate-database", feature: "recruitment.view_candidates" },
      { label: "Job Applications", href: "/modules/recruitment/job-applications", feature: "recruitment.view_applications" },
      { label: "Screening", href: "/modules/recruitment/screening", feature: "recruitment.candidates" },
      { label: "Talent Pool", href: "/modules/recruitment/talent-pool", feature: "recruitment.candidates" },
      { label: "Candidate Activities", href: "/modules/recruitment/candidate-activities", feature: "recruitment.candidates" },
      { label: "Candidate Documents", href: "/modules/recruitment/candidate-documents", feature: "recruitment.candidates" },
      { label: "Employee Referrals", href: "/modules/recruitment/employee-referrals", feature: "recruitment.candidates" },
    ],
  },
  {
    label: "Interviews",
    children: [
      { label: "Interview Schedule", href: "/modules/recruitment/interview-schedule", feature: "recruitment.schedule_interviews" },
      { label: "Interview Tracker", href: "/modules/recruitment/interview-tracker", feature: "recruitment.interviews" },
      { label: "Interview Feedback", href: "/modules/recruitment/interview-feedback", feature: "recruitment.interviews" },
      { label: "Assessment Tracker", href: "/modules/recruitment/assessment-tracker", feature: "recruitment.interviews" },
    ],
  },
  { label: "AI Human Interviewer", href: "/modules/recruitment/ai-interviewer", feature: "recruitment.interviews", premiumAiInterview: true },
  {
    label: "Selection & Onboarding",
    children: [
      { label: "Selection & Offers", href: "/modules/recruitment/selection-offers", feature: "recruitment.offers" },
      { label: "Job Offer Letter", href: "/modules/recruitment/job-offer-letter", feature: "recruitment.manage_offers" },
      { label: "Background Verification", href: "/modules/recruitment/background-verification", feature: "recruitment.candidates" },
      { label: "Reference Check", href: "/modules/recruitment/reference-check", feature: "recruitment.candidates" },
      { label: "Pre-Joining", href: "/modules/recruitment/pre-joining", feature: "recruitment.offers" },
      { label: "Onboarding", href: "/modules/recruitment/onboarding", feature: "recruitment.manage_offers" },
    ],
  },
  {
    label: "Recruitment Operations",
    children: [
      { label: "Recruitment Tasks", href: "/modules/recruitment/recruitment-tasks", feature: "recruitment.candidates" },
      { label: "Recruitment Follow-ups", href: "/modules/recruitment/recruitment-followups", feature: "recruitment.candidates" },
      { label: "Recruitment Vendors", href: "/modules/recruitment/recruitment-vendors", feature: "recruitment.requisitions" },
      { label: "Recruitment Costs", href: "/modules/recruitment/recruitment-costs", feature: "recruitment.requisitions" },
    ],
  },
  {
    label: "Communication",
    children: [
      { label: "Email", href: "/modules/recruitment/emails", feature: "recruitment.view_emails" },
      { label: "Email Templates", href: "/modules/recruitment/email-templates", feature: "recruitment.view_email_templates" },
    ],
  },
  {
    label: "Reports & Settings",
    children: [
      { label: "Recruit Report", href: "/modules/recruitment/recruit-job-report", feature: "recruitment.view_reports" },
      { label: "Recruitment Settings", href: "/modules/recruitment/recruitment-settings", feature: "recruitment.view_settings" },
      { label: "Career Site", href: "/modules/recruitment/career-site", feature: "recruitment.view_jobs" },
    ],
  },
]

// Operations sidebar organised as a hierarchical ERP structure. Parent groups
// are collapsible; every existing leaf keeps its original route + permission
// slug so current pages, URLs and permissions keep working. New sub-modules
// slot into their group and are gated by their own operations.view_* feature.
const OPERATIONS_CHILDREN: FeatureChild[] = [
  {
    label: "Dashboard",
    children: [
      { label: "Operations Dashboard", href: "/modules/operations", feature: "operations.view_dashboard" },
    ],
  },
  {
    label: "Projects",
    children: [
      { label: "Project Management", href: "/modules/operations/projects", feature: "operations.view_projects" },
      { label: "Project Milestones", href: "/modules/operations/milestones", feature: "operations.view_milestones" },
      { label: "Project Deliverables", href: "/modules/operations/deliverables", feature: "operations.view_deliverables" },
      { label: "Project Teams", href: "/modules/operations/teams", feature: "operations.view_teams" },
      { label: "Project Documents", href: "/modules/operations/project-documents", feature: "operations.view_project_documents" },
    ],
  },
  {
    label: "Work Management",
    children: [
      { label: "Tasks", href: "/modules/operations/tasks", feature: "operations.view_tasks" },
      { label: "Task Board", href: "/modules/operations/task-board", feature: "operations.view_task_board" },
      { label: "Work Orders", href: "/modules/operations/work-orders", feature: "operations.view_work_orders" },
      { label: "Meetings", href: "/modules/operations/meetings", feature: "operations.view_meetings" },
      { label: "Calendar", href: "/modules/operations/calendar", feature: "operations.view_calendar" },
    ],
  },
  {
    label: "Resources",
    children: [
      { label: "Resources", href: "/modules/operations/resources", feature: "operations.view_resources" },
      { label: "Resource Requests", href: "/modules/operations/resource-requests", feature: "operations.view_resource_requests" },
      { label: "Allocations", href: "/modules/operations/allocations", feature: "operations.view_allocations" },
      { label: "Skill Matrix", href: "/modules/operations/skill-matrix", feature: "operations.view_skill_matrix" },
      { label: "Capacity Planning", href: "/modules/operations/capacity-planning", feature: "operations.view_capacity_planning" },
      { label: "Utilization", href: "/modules/operations/utilization", feature: "operations.view_utilization" },
      { label: "Resource Conflict", href: "/modules/operations/resource-conflict", feature: "operations.view_resource_conflict" },
    ],
  },
  {
    label: "Timesheets",
    children: [
      { label: "Timesheet Management", href: "/modules/operations/timesheets", feature: "operations.view_timesheets" },
      { label: "Time Tracking", href: "/modules/operations/time-tracking", feature: "operations.view_time_tracking" },
      { label: "Productivity", href: "/modules/operations/productivity", feature: "operations.view_productivity" },
    ],
  },
  {
    label: "Quality & SLA",
    children: [
      { label: "Quality Reviews", href: "/modules/operations/quality", feature: "operations.view_quality" },
      { label: "QA Audits", href: "/modules/operations/qa-audits", feature: "operations.view_qa_audits" },
      { label: "SLA Monitoring", href: "/modules/operations/sla-monitoring", feature: "operations.view_sla_monitoring" },
      { label: "Quality Scorecards", href: "/modules/operations/scorecards", feature: "operations.view_scorecards" },
      { label: "Scorecard Criteria", href: "/modules/operations/scorecard-criteria", feature: "operations.view_scorecard_criteria" },
      { label: "Corrective Actions", href: "/modules/operations/corrective-actions", feature: "operations.view_corrective_actions" },
    ],
  },
  {
    label: "Issues",
    children: [
      { label: "Issue Register", href: "/modules/operations/issues", feature: "operations.view_issues" },
      { label: "Escalations", href: "/modules/operations/escalations", feature: "operations.view_escalations" },
      { label: "Root Cause / CAPA", href: "/modules/operations/root-cause-capa", feature: "operations.view_root_cause_capa" },
    ],
  },
  {
    label: "Process Management",
    children: [
      { label: "SOPs", href: "/modules/operations/sops", feature: "operations.view_sops" },
      { label: "Checklists", href: "/modules/operations/checklists", feature: "operations.view_checklists" },
      { label: "Approvals", href: "/modules/operations/approvals", feature: "operations.view_approvals" },
    ],
  },
  {
    label: "Client Operations",
    children: [
      { label: "Client Requirements", href: "/modules/operations/client-requirements", feature: "operations.view_client_requirements" },
      { label: "Client Deliverables", href: "/modules/operations/client-deliverables", feature: "operations.view_client_deliverables" },
      { label: "Client Approvals", href: "/modules/operations/client-approvals", feature: "operations.view_client_approvals" },
    ],
  },
  {
    label: "Finance",
    children: [
      { label: "Project Cost", href: "/modules/operations/project-cost", feature: "operations.view_project_cost" },
      { label: "Project Revenue", href: "/modules/operations/project-revenue", feature: "operations.view_project_revenue" },
      { label: "Resource Cost", href: "/modules/operations/resource-cost", feature: "operations.view_resource_cost" },
      { label: "Vendor Cost", href: "/modules/operations/vendor-cost", feature: "operations.view_vendor_cost" },
      { label: "Budget vs Actual", href: "/modules/operations/budget-vs-actual", feature: "operations.view_budget_vs_actual" },
      { label: "Project Profitability", href: "/modules/operations/project-profitability", feature: "operations.view_project_profitability" },
    ],
  },
  {
    label: "Risk Management",
    children: [
      { label: "Risk Register", href: "/modules/operations/risks", feature: "operations.view_risks" },
    ],
  },
  {
    label: "Communication",
    children: [
      { label: "Emails", href: "/modules/operations/emails", feature: "operations.send_emails" },
      { label: "Email Templates", href: "/modules/operations/email-templates", feature: "operations.view_email_templates" },
    ],
  },
]

  const CLIENTS_CHILDREN = [
    { label: "Clients", href: "/modules/clients/clients", feature: "clients.view_clients" },
    { label: "Contacts", href: "/modules/clients/contacts", feature: "clients.view_contacts" },
  { label: "Client Portal", href: "/modules/clients/client-portal", feature: "clients.manage_clients" },
  ]

const TICKETS_CHILDREN = [
  { label: "All Tickets", href: "/modules/tickets/all", feature: "tickets.view_tickets" },
  { label: "SLA Management", href: "/modules/tickets/sla", feature: "tickets.view_sla" },
  { label: "Knowledge Base", href: "/modules/tickets/knowledge-base", feature: "tickets.view_knowledge_base" },
]

const PRODUCTS_CHILDREN = [
  { label: "Product Catalog", href: "/modules/products/catalog", feature: "products.view_products" },
]

const LEGAL_CHILDREN = [
  { label: "Contracts", href: "/modules/legal/contracts", feature: "legal.view_contracts" },
  { label: "Templates", href: "/modules/legal/templates", feature: "legal.view_contract_templates" },
  { label: "Esign", href: "/modules/legal/esign", feature: "legal.view_esign" },
]

const ASSETS_CHILDREN = [
  { label: "Employee Assets", href: "/modules/assets/employee-assets", feature: "assets.view_employee_assets" },
    { label: "Company Subscriptions", href: "/modules/assets/company-subscriptions", feature: "assets.view_company_subscriptions" },
  { label: "Software Licenses", href: "/modules/assets/software-licenses", feature: "assets.view_software_licenses" },
  { label: "Warranty & Maintenance", href: "/modules/assets/asset-lifecycle", feature: "assets.view_asset_lifecycle" },
  ]

const SALES_CHILDREN: FeatureChild[] = [
  {
    label: "Overview & Insights",
    children: [
      { label: "Overview", href: "/modules/sales/dashboard", feature: "sales.view_dashboard" },
      { label: "Forecast", href: "/modules/sales/forecast", feature: "sales.view_forecast" },
    ],
  },
  {
    label: "Pipeline & Activities",
    children: [
      { label: "Leads", href: "/modules/sales/leads", feature: "sales.view_leads" },
      { label: "Follow-ups", href: "/modules/sales/followups", feature: "sales.view_followups" },
      { label: "Deals", href: "/modules/sales/deals", feature: "sales.view_deals" },
      { label: "Meetings", href: "/modules/sales/meetings", feature: "sales.view_meetings" },
    ],
  },
  {
    label: "Accounts & Customers",
    children: [
      { label: "Companies", href: "/modules/sales/companies", feature: "sales.view_companies" },
      { label: "Contacts", href: "/modules/sales/contacts", feature: "sales.view_contacts" },
    ],
  },
  {
    label: "Sales Execution",
    children: [
      { label: "Quotations", href: "/modules/sales/quotations", feature: "sales.view_quotations" },
      { label: "Sales Orders", href: "/modules/sales/sales-order-management", feature: "sales.view_sales_orders" },
      { label: "Contracts", href: "/modules/sales/contracts", feature: "sales.view_contracts" },
      { label: "Client Onboarding", href: "/modules/sales/onboarding", feature: "sales.manage_onboarding" },
    ],
  },
  {
    label: "Communications",
    children: [
      { label: "Sales Emails", href: "/modules/sales/emails", feature: "sales.send_emails" },
      { label: "Email Templates", href: "/modules/sales/email-templates", feature: "sales.view_email_templates" },
    ],
  },
]

// Every entity 360 page lives in this single top-level "360 View" module rather
// than inside its owning module. Gates mirror each page's own access check;
// Employee 360 has no gate because it self-scopes for users without HR access.
const ENTITY_360_CHILDREN: FeatureChild[] = [
  { label: "Client 360", href: "/modules/clients/client-360", feature: "clients.view_clients", view360: "client" },
  { label: "Customer 360", href: "/modules/sales/customer-360", feature: "sales.view_companies", view360: "customer" },
  { label: "Vendor 360", href: "/modules/finance/vendor-360", feature: "finance.view_customers_vendors", view360: "vendor" },
  { label: "Employee 360", href: "/modules/hr/employee-360", view360: "employee" },
  { label: "Candidate 360", href: "/modules/recruitment/candidate-360", feature: "recruitment.view_candidates", view360: "candidate" },
  { label: "Project 360", href: "/modules/operations/project-360", feature: "operations.view_projects", view360: "project" },
  { label: "Contract 360", href: "/modules/sales/contract-360", feature: "sales.view_contracts", view360: "contract" },
  { label: "Asset 360", href: "/modules/assets/asset-360", feature: "it.view_assets", view360: "asset" },
]

// Every Administration sub-module. This is the single source of truth for the
// Administration section so the workspace sidebar and the /admin routes expose
// exactly the same set of links — navigating into any admin page keeps the same
// sidebar instead of swapping to a different shell.
// Only grouping is a display concern: every leaf keeps its original route.
// The Platform console leaf is appended to Platform Operations at build time
// for platform-role users only (see buildAdministrationChildren).
export const ADMINISTRATION_CHILDREN: NavChild[] = [
  {
    label: "Overview",
    children: [
      // Tenant control center — moved here from the Administration landing page.
      { label: "Dashboard", href: "/admin/dashboard" },
      { label: "Workspace updates", href: "/admin/updates" },
    ],
  },
  {
    label: "Access & Governance",
    children: [
      { label: "User lifecycle", href: "/admin/users" },
      { label: "Roles & permissions", href: "/admin/roles" },
      { label: "Data permissions", href: "/admin/data-permissions" },
      { label: "Approval authority", href: "/admin/approval-authority" },
      { label: "Maker-checker", href: "/admin/maker-checker" },
      { label: "Segregation of duties", href: "/admin/sod" },
    ],
  },
  {
    label: "Organization",
    children: [
      // Organization hierarchy management (org ����� entity ��� BU → … ��� team).
      { label: "Organization hierarchy", href: "/modules/organization" },
      // Multi-entity: the legal-entity registry (separate tax/bank/books).
      { label: "Legal entities", href: "/modules/finance/legal-entities" },
      { label: "Employee Links", href: "/admin/employee-links" },
    ],
  },
  {
    label: "Business Configuration",
    children: [
      // Moved out of the Finance module — tenant-wide financial configuration.
      { label: "Fiscal Year", href: "/modules/finance/fiscal-year" },
      { label: "Multi-Currency", href: "/modules/finance/multi-currency" },
      { label: "Policy inheritance", href: "/admin/policies" },
    ],
  },
  {
    label: "Integrations",
    children: [
      { label: "Integration secrets", href: "/admin/integration-secrets" },
      { label: "Integration sync", href: "/admin/integration-sync" },
    ],
  },
  {
    label: "Platform Operations",
    children: [
      { label: "Job monitoring", href: "/admin/job-monitoring" },
      // Tenant health score derived from platform signals (jobs, errors,
      // billing, seats) — workspace/service health, not client success.
      { label: "Customer health", href: "/admin/customer-success" },
      { label: "Maintenance windows", href: "/admin/maintenance" },
    ],
  },
  { label: "Settings", href: "/admin/settings" },
]

// SPECS 46–49 — The Automation Center groups the existing workflow engine with
// the event, notification and email monitoring surfaces under one admin area so
// automation is not scattered. Every entry is an existing, real-data-backed
// admin page; nothing here creates a second engine.
export const AUTOMATION_CHILDREN: NavChild[] = [
  { label: "Overview", href: "/admin/automation" },
  { label: "Workflows", href: "/admin/workflows" },
  { label: "Events", href: "/admin/automation/events" },
  { label: "Notifications", href: "/admin/automation/notifications" },
  { label: "Email", href: "/admin/automation/email" },
  { label: "Email Engine", href: "/admin/automation/email-engine" },
]

// SPECS 56–66 — Security & Access groups tenant SSO, MFA, password policy,
// sessions, IP allowlist, access policies, temporary/emergency access and
// access reviews under one admin area. Each entry maps to a page under
// /admin/security/*. Screens surface the real backend where one exists (MFA
// enrollment, password change) and show honest "not yet available" states
// where the platform cannot enforce the capability — no settings are faked.
export const SECURITY_CHILDREN: NavChild[] = [
  { label: "Overview", href: "/admin/security" },
  { label: "Single sign-on (SSO)", href: "/admin/security/sso" },
  { label: "Multi-factor auth", href: "/admin/security/mfa" },
  { label: "Password policy", href: "/admin/security/password" },
  { label: "Sessions", href: "/admin/security/sessions" },
  { label: "IP allowlist", href: "/admin/security/ip-allowlist" },
  { label: "Access policies", href: "/admin/security/access-policies" },
  { label: "Temporary access", href: "/admin/security/temporary-access" },
  { label: "Emergency access", href: "/admin/security/emergency-access" },
  { label: "Access reviews", href: "/admin/security/access-reviews" },
]

// Developer center groups API key issuance, usage/rate-limit
// dashboards, and webhook delivery under one admin area, distinct from
// Security & Access per the navigation audit.
export const DEVELOPER_CHILDREN: NavChild[] = [
  { label: "API Keys", href: "/admin/security/api-webhooks" },
  { label: "API Usage", href: "/admin/security/api-webhooks/usage" },
  { label: "Rate Limits", href: "/admin/security/api-webhooks/rate-limits" },
  { label: "Webhooks", href: "/admin/security/api-webhooks#webhooks" },
]

// SPECS 67–74 — Data governance groups the central tenant audit log,
// classification, field security, retention, legal holds, and the
// import/export centers under one admin area. Each entry maps to a page
// under /admin/governance/*.
export const GOVERNANCE_CHILDREN: NavChild[] = [
  { label: "Audit log", href: "/admin/governance" },
  { label: "Classification", href: "/admin/governance/classification" },
  { label: "Field security", href: "/admin/governance/field-security" },
  { label: "Retention", href: "/admin/governance/retention" },
  { label: "Legal holds", href: "/admin/governance/legal-holds" },
  { label: "Import center", href: "/admin/governance/import-center" },
  { label: "Export center", href: "/admin/governance/export-center" },
]

// Subscription & Billing — a dedicated admin module that sits directly below
// Administration in the sidebar. Every entry maps to a page under
// /modules/billing/* so the whole billing lifecycle (plans, subscriptions,
// invoicing, payments, reconciliation, reporting) is reachable from one place.
// Entries are grouped into collapsible dropdowns (like Administration); routes are unchanged.
export const BILLING_CHILDREN: NavChild[] = [
  {
    label: "Subscriptions",
    children: [
      { label: "Subscription Management", href: "/modules/billing/subscriptions" },
      { label: "Plan Management", href: "/modules/billing/plans" },
      { label: "Feature Entitlements", href: "/modules/billing/entitlements" },
      { label: "Usage Metering", href: "/modules/billing/usage-metering" },
      { label: "Renewals", href: "/modules/billing/renewals" },
    ],
  },
  {
    label: "Billing",
    children: [
      { label: "Billing", href: "/modules/billing/billing" },
      { label: "Invoices & Credit Notes", href: "/modules/billing/invoices" },
      { label: "Credits & Adjustments", href: "/modules/billing/credits" },
      { label: "Coupons & Discounts", href: "/modules/billing/coupons" },
      { label: "Refunds", href: "/modules/billing/refunds" },
    ],
  },
  {
    label: "Payments",
    children: [
      { label: "Payment Gateways", href: "/modules/billing/payment-gateways" },
      { label: "Payment Webhooks", href: "/modules/billing/payment-webhooks" },
      { label: "Payment Reconciliation", href: "/modules/billing/reconciliation" },
    ],
  },
  {
    label: "Customer",
    children: [{ label: "Customer Billing Portal", href: "/modules/billing/customer-portal" }],
  },
  {
    label: "Administration",
    children: [
      { label: "Billing Reports", href: "/modules/billing/reports" },
      { label: "Billing Settings", href: "/modules/billing/settings" },
    ],
  },
]

// Business-line modules (not stored in the `modules` table). Single source of
// truth for their sidebar entries; registered by mergeBusinessLineModules.
export const BUSINESS_LINE_MODULES: { slug: string; label: string; href: string; feature: string; icon: NavItem["icon"]; children?: FeatureChild[] }[] = [
  {
    slug: "publishing",
    label: "Publishing",
    href: "/modules/publishing",
    feature: "publishing.view_alt_text",
    icon: <BookOpen className="size-4" />,
    children: [{ label: "Alt Text", href: "/modules/publishing/alt-text", feature: "publishing.view_alt_text" }],
  },
  {
    slug: "edtech",
    label: "EdTech",
    href: "/modules/edtech",
    feature: "edtech.view_overview",
    icon: <GraduationCap className="size-4" />,
  },
  {
    slug: "bpo",
    label: "BPO",
    href: "/modules/bpo",
    feature: "bpo.view_overview",
    icon: <Headset className="size-4" />,
  },
  {
    slug: "technology",
    label: "Technology",
    href: "/modules/technology",
    feature: "technology.view_overview",
    icon: <Code2 className="size-4" />,
  },
]

// SPECS 1/3/4/5 — The Muenot platform / super-admin console lives in its own
// route tree (`/platform`, gated on the platform axis). Surfacing it as a
// single Administration entry connects that already-built UI to the sidebar
// WITHOUT merging it into the tenant Administration pages — the platform vs
// tenant boundary is preserved because the link is only added for
// users who actually carry a platform role.
const PLATFORM_CONSOLE_CHILD: NavChild = { label: "Platform console", href: "/platform" }

function buildAdministrationChildren(isPlatformUser: boolean): NavChild[] {
  if (!isPlatformUser) return ADMINISTRATION_CHILDREN
  return ADMINISTRATION_CHILDREN.map((group) =>
    group.label === "Platform Operations" && group.children
      ? { ...group, children: [...group.children, PLATFORM_CONSOLE_CHILD] }
      : group,
  )
}

/**
 * Build the workspace sidebar navigation for a signed-in user. Shared by the
 * workspace layout and the /admin layout so both render an identical sidebar —
 * clicking an Administration entry no longer redirects into a separate console
 * shell with a different nav.
 */
export async function buildWorkspaceNav(
  session: SessionPayload,
  settings: Record<string, string | undefined>,
): Promise<NavItem[]> {
  const HIDDEN_MODULES = new Set(["biolinks", "biometric", "letter", "monitor-center", "monitor center"])
  // Spec50: the plan entitlement must hide a module too, not just the toggle —
  // otherwise a plan-locked module shows in the sidebar and then 404s.
  const planGate = await loadModuleGate(session.tenantId).catch((): ModuleGate => () => true)
  const canAccessLegacyOperations = await ownsGlobalErpLedger(currentTenantIdOrNull())
  const modules = (await getUserAccessibleModules(session.userId, session.role))
    .filter((m) => !HIDDEN_MODULES.has(m.slug.toLowerCase()) && !HIDDEN_MODULES.has(m.name.toLowerCase()))
    .filter((m) => settingEnabled(settings[`module.${m.slug.toLowerCase()}`]))
    .filter((m) => planGate(m.slug))
    .filter((m) => m.slug !== "operations" || canAccessLegacyOperations)

  const canAccess = await getFeatureChecker(session.userId, session.role)
  const premiumTenantId = currentTenantIdOrNull() ?? session.effectiveTenantId ?? session.tenantId
  const aiInterviewEntitled = premiumTenantId == null ? false : await getTenantEntitlements(premiumTenantId)
    .then(hasAiInterviewerEntitlement).catch(() => false)
  const canOpen360 = await getEntity360Checker(session.userId, session.role)
  const canOpenDashboard = await getDashboardChecker(session.userId, session.role)

  const buildChildren = (nodes: FeatureChild[]): NavChild[] =>
    nodes.flatMap<NavChild>((c) => {
      if (c.children && c.children.length > 0) {
        const sub = buildChildren(c.children)
        return sub.length > 0 ? [{ label: c.label, children: sub }] : []
      }
      if (c.view360 && !canOpen360(c.view360)) return []
      if (c.premiumAiInterview && !aiInterviewEntitled) return []
      return c.feature && !canAccess(c.feature) ? [] : [{ label: c.label, href: c.href }]
    })

  const navItems: NavItem[] = [
    {
      label: "Dashboard",
      href: "/dashboard",
      icon: <LayoutDashboard className="size-4" />,
      children: [
        ...(canOpenDashboard("private") ? [{ label: "Private Dashboard", href: "/dashboard" }] : []),
        // Admins get the Executive Dashboard under /admin (pushed below).
        ...(session.role !== "admin" && canOpenDashboard("executive")
          ? [{ label: "Executive Dashboard", href: "/dashboard/executive" }]
          : []),
      ],
    },
    ...modules.map((m) => {
      const item: NavItem = {
        label: m.slug === "assets" ? "Assets & Subscriptions" : m.name,
        href: `/modules/${m.slug}`,
        icon: moduleIcons[m.slug] ?? <Settings2 className="size-4" />,
      }
      if (["hr", "sales", "finance", "recruitment", "operations", "clients", "products", "legal", "assets"].includes(m.slug)) {
        const source =
          m.slug === "hr"
            ? HR_CHILDREN
            : m.slug === "finance"
              ? FINANCE_CHILDREN
              : m.slug === "recruitment"
                ? RECRUITMENT_CHILDREN
                : m.slug === "operations"
                  ? OPERATIONS_CHILDREN
                  : m.slug === "clients"
                    ? CLIENTS_CHILDREN
                    : m.slug === "products"
                      ? PRODUCTS_CHILDREN
                      : m.slug === "legal"
                        ? LEGAL_CHILDREN
                        : m.slug === "assets"
                          ? ASSETS_CHILDREN
                          : SALES_CHILDREN
        const children = buildChildren(source as FeatureChild[])
        if (children.length > 0) item.children = children
      }
      return item
    }),
  ]

  // 360 View sits directly below Dashboard.
  const entity360Children = buildChildren(ENTITY_360_CHILDREN)
  if (entity360Children.length > 0) {
    navItems.splice(1, 0, {
      label: "360 View",
      href: entity360Children.find((child) => child.href)?.href ?? "/dashboard",
      icon: <Orbit className="size-4" />,
      children: entity360Children,
    })
  }

  // Company Hub groups the Events, Notice Board and Knowledge Base modules into
  // a single dropdown placed where the first of them would have appeared.
  const COMPANY_HUB_ORDER = ["events", "notice board", "knowledge base"]
  const normalizeLabel = (label: string) => label.toLowerCase().replace(/[-_]/g, " ").trim()
  const hubIndexes = navItems
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => COMPANY_HUB_ORDER.includes(normalizeLabel(item.label)))
  if (hubIndexes.length > 0) {
    const hubChildren: NavChild[] = hubIndexes
      .map(({ item }) => item)
      .sort((a, b) => COMPANY_HUB_ORDER.indexOf(normalizeLabel(a.label)) - COMPANY_HUB_ORDER.indexOf(normalizeLabel(b.label)))
      .map((item) => ({ label: item.label, href: item.href }))
    const firstHubIndex = hubIndexes[0].index
    for (const { index } of [...hubIndexes].reverse()) navItems.splice(index, 1)
    // Company Hub sits directly above My Calendar when the calendar is present.
    const calendarIndex = navItems.findIndex((i) => i.href === "/modules/calendar")
    const insertAt = calendarIndex >= 0 ? calendarIndex : firstHubIndex
    navItems.splice(insertAt, 0, {
      label: "Company Hub",
      href: hubChildren.find((child) => child.href)?.href ?? "/dashboard",
      icon: <Building2 className="size-4" />,
      children: hubChildren,
    })
  }

  const clientsIndex = navItems.findIndex((i) => i.href === "/modules/clients")
  if (clientsIndex >= 0) {
    const [clientsItem] = navItems.splice(clientsIndex, 1)
    const operationsIndex = navItems.findIndex((i) => i.href === "/modules/operations")
    navItems.splice(operationsIndex >= 0 ? operationsIndex + 1 : clientsIndex, 0, clientsItem)
  }

  // WhatsApp is its own top-level module (not stored in the modules table).
  if (!navItems.some((i) => i.href === "/modules/whatsapp")) {
    const whatsappItem: NavItem = {
      label: "WhatsApp",
      href: "/modules/whatsapp",
      icon: <MessageCircle className="size-4" />,
    }
    const messagesIndex = navItems.findIndex((i) => i.href === "/modules/messages")
    if (messagesIndex >= 0) navItems.splice(messagesIndex + 1, 0, whatsappItem)
    else navItems.push(whatsappItem)
  }

  // Muenot Voice — a top-level module (not stored in the modules table). Its
  // section navigation and role gating live in the Voice layout itself.
  if (!navItems.some((i) => i.href === "/modules/voice")) {
    const voiceItem: NavItem = {
      label: "Muenot Voice",
      href: "/modules/voice",
      icon: <PhoneCall className="size-4" />,
    }
    const whatsappIndex = navItems.findIndex((i) => i.href === "/modules/whatsapp")
    if (whatsappIndex >= 0) navItems.splice(whatsappIndex + 1, 0, voiceItem)
    else navItems.push(voiceItem)
  }

  // IT Management — a top-level module (not stored in the modules table). Lists
  // seven workspace sections (Operations Center, Technology Estate, Service
  // Command, Technology Governance, Work Hub, Control Center, Platform Studio)
  // built from lib/it/config. Pages render in each section's own navigation.
  if (!navItems.some((i) => i.href === IT_BASE)) {
    navItems.push({
      label: "IT Management",
      href: IT_BASE,
      icon: <ServerIcon className="size-4" />,
      children: buildItNavChildren(),
    })
  }

  // SPEC 110 — Centralized Task Engine. A top-level module (not stored in the
  // modules table) available to every workspace member; access is scoped to
  // the acting tenant at the data layer.
  if (!navItems.some((i) => i.href === "/modules/tasks")) {
    navItems.push({
      label: "Tasks",
      href: "/modules/tasks",
      icon: <ListChecks className="size-4" />,
    })
  }

  // Process OS — top-level, gated by the Access Control engine (process.instances.view).
  const navTenantId = session.tenantId ?? currentTenantIdOrNull()
  const accessChecker = navTenantId == null ? null : await getAccessChecker({ tenantId: navTenantId, userId: session.userId, role: session.role }).catch(() => null)
  const canProcess = (p: string) => session.role === "admin" || Boolean(accessChecker && (accessChecker.has(p) || accessChecker.can(p)))
  if (canProcess("process.instances.view") && !navItems.some((i) => i.href === "/process-os")) {
    const processChildren: NavChild[] = [
      { label: "Command Center", href: "/process-os" },
      { label: "My Work", href: "/process-os/my-work" },
      { label: "Instances", href: "/process-os/instances" },
      { label: "Approvals", href: "/process-os/approvals" },
      { label: "Exceptions", href: "/process-os/exceptions" },
      { label: "Templates", href: "/process-os/templates" },
    ]
    if (canProcess("process.analytics.view")) processChildren.push({ label: "SLA Monitor", href: "/process-os/sla" }, { label: "Analytics", href: "/process-os/analytics" })
    if (canProcess("process.definitions.edit") || canProcess("process.definitions.publish")) processChildren.push({ label: "Definitions", href: "/process-os/definitions" })
    navItems.push({ label: "Process OS", href: "/process-os", icon: <Workflow className="size-4" />, children: processChildren })
  }

  // Inject the Marketing module (not stored in the modules table).
  if (!navItems.some((i) => i.href === "/modules/marketing")) {
    const marketingChildren = buildChildren(MARKETING_CHILDREN)
    if (marketingChildren.length > 0) {
      navItems.push({
        label: "Marketing",
        href: "/modules/marketing",
        icon: <Megaphone className="size-4" />,
        children: marketingChildren,
      })
    }
  }

  // Products, Legal and IT Management sit directly above My Calendar.
  const aboveCalendarHrefs = ["/modules/products", "/modules/legal", IT_BASE]
  const aboveCalendarItems = aboveCalendarHrefs.flatMap((href) => {
    const index = navItems.findIndex((i) => i.href === href)
    return index >= 0 ? navItems.splice(index, 1) : []
  })
  if (aboveCalendarItems.length > 0) {
    const calendarIndex = navItems.findIndex((i) => i.href === "/modules/calendar")
    if (calendarIndex >= 0) navItems.splice(calendarIndex, 0, ...aboveCalendarItems)
    else navItems.push(...aboveCalendarItems)
  }

  // Administration console — restricted to platform/tenant admins. Groups every
  // admin management page under a single expandable entry so they are reachable
  // from the workspace sidebar and open in the same shell (no redirect).
  if (session.role === "admin") {
    const isPlatformUser = session.platformRole != null && session.platformRole !== "none"
    const adminChildren = buildAdministrationChildren(isPlatformUser)
    navItems.push({
      label: "Administration",
      href: "/admin",
      icon: <ShieldCheck className="size-4" />,
      children: adminChildren,
    })

    // Spec53 (#71-72) — Executive dashboards are listed under the Dashboard
    // dropdown, below Private Dashboard. Cross-functional metrics are computed
    // live from tenant data, with per-category redaction handled server-side.
    const dashboardItem = navItems.find((item) => item.href === "/dashboard")
    dashboardItem?.children?.push({
      label: "Executive Dashboard",
      href: "/admin/executive-dashboard",
    })

    // Subscription & Billing sits directly below Administration and is likewise
    // restricted to admins.
    navItems.push({
      label: "Subscription & Billing",
      href: "/modules/billing",
      icon: <CreditCard className="size-4" />,
      children: BILLING_CHILDREN,
    })

    // IT Admin groups the admin-only platform consoles. Each child page carries
    // its own in-page tab bar for its sub-sections.
    navItems.push({
      label: "IT Admin",
      href: "/admin/it-admin",
      icon: <MonitorCog className="size-4" />,
      children: [
        { label: "Automation", href: "/admin/automation" },
        { label: "Security & Access", href: "/admin/security" },
        { label: "Data Governance", href: "/admin/governance" },
        { label: "AI Governance", href: "/admin/ai-governance" },
        { label: "Storage", href: "/modules/storage" },
      ],
    })
  }

  // Marketing sits directly below Operations.
  const marketingIndex = navItems.findIndex((i) => i.href === "/modules/marketing")
  if (marketingIndex >= 0) {
    const [marketingItem] = navItems.splice(marketingIndex, 1)
    const operationsNavIndex = navItems.findIndex((i) => i.href === "/modules/operations")
    navItems.splice(operationsNavIndex >= 0 ? operationsNavIndex + 1 : marketingIndex, 0, marketingItem)
  }

  // IT Admin sits directly above IT Management.
  const aboveItManagementItems = ["/admin/it-admin"].flatMap((href) => {
    const index = navItems.findIndex((i) => i.href === href)
    return index >= 0 ? navItems.splice(index, 1) : []
  })
  if (aboveItManagementItems.length > 0) {
    const itIndex = navItems.findIndex((i) => i.href === IT_BASE)
    if (itIndex >= 0) navItems.splice(itIndex, 0, ...aboveItManagementItems)
    else navItems.push(...aboveItManagementItems)
  }

  // Subscription & Billing sits directly below IT Management.
  const billingIndex = navItems.findIndex((i) => i.href === "/modules/billing")
  if (billingIndex >= 0) {
    const [billingItem] = navItems.splice(billingIndex, 1)
    const itIndex = navItems.findIndex((i) => i.href === IT_BASE)
    navItems.splice(itIndex >= 0 ? itIndex + 1 : billingIndex, 0, billingItem)
  }

  // Administration sits directly above Subscription & Billing.
  const adminIndex = navItems.findIndex((i) => i.href === "/admin")
  if (adminIndex >= 0) {
    const [adminItem] = navItems.splice(adminIndex, 1)
    const billingNavIndex = navItems.findIndex((i) => i.href === "/modules/billing")
    navItems.splice(billingNavIndex >= 0 ? billingNavIndex : adminIndex, 0, adminItem)
  }

  // The Communication group (Messages, WhatsApp, Muenot Voice) sits directly
  // below Products. The sidebar groups these consecutive leaves together.
  const communicationItems = ["/modules/messages", "/modules/whatsapp", "/modules/voice"].flatMap((href) => {
    const index = navItems.findIndex((i) => i.href === href)
    return index >= 0 ? navItems.splice(index, 1) : []
  })
  if (communicationItems.length > 0) {
    const productsIndex = navItems.findIndex((i) => i.href === "/modules/products")
    navItems.splice(productsIndex >= 0 ? productsIndex + 1 : navItems.length, 0, ...communicationItems)
  }

  // Others groups miscellaneous pages at the bottom of the sidebar. Report
  // Builder remains restricted to admins.
  const othersChildren: NavChild[] = []
  if (session.role === "admin") {
    othersChildren.push({ label: "Report Builder", href: "/admin/reports" })
  }
  othersChildren.push({ label: "Activity", href: "/modules/activity" })
  navItems.push({
    label: "Others",
    href: "/modules/activity",
    icon: <HistoryIcon className="size-4" />,
    children: othersChildren,
  })

  // Vendor Portal is a standalone top-level entry directly below Others.
  if (canAccess("finance.view_vendor_portal") && !navItems.some((i) => i.href === "/modules/finance/vendor-portal")) {
    navItems.push({
      label: "Vendor Portal",
      href: "/modules/finance/vendor-portal",
      icon: <DoorOpen className="size-4" />,
    })
  }

  // Keep Assets & Subscriptions directly below Tasks in the sidebar.
  const assetsIndex = navItems.findIndex((item) => item.href === "/modules/assets")
  const tasksIndex = navItems.findIndex((item) => item.href === "/modules/tasks")
  if (assetsIndex >= 0 && tasksIndex >= 0) {
    const [assetsItem] = navItems.splice(assetsIndex, 1)
    const updatedTasksIndex = navItems.findIndex((item) => item.href === "/modules/tasks")
    navItems.splice(updatedTasksIndex + 1, 0, assetsItem)
  }

  // Tickets and Tasks sit as standalone top-level entries directly below
  // Vendor Portal (or Others when Vendor Portal is hidden), outside the
  // Communication group.
  const bottomItems = ["/modules/tickets", "/modules/tasks"].flatMap((href) => {
    const index = navItems.findIndex((i) => i.href === href)
    return index >= 0 ? navItems.splice(index, 1) : []
  })
  if (bottomItems.length > 0) {
    const anchorIndex = Math.max(
      navItems.findIndex((i) => i.href === "/modules/finance/vendor-portal"),
      navItems.findIndex((i) => i.label === "Others"),
    )
    navItems.splice(anchorIndex >= 0 ? anchorIndex + 1 : navItems.length, 0, ...bottomItems)
  }
  for (const item of navItems) {
    if (["/modules/finance/vendor-portal", "/modules/tickets", "/modules/tasks"].includes(item.href)) {
      item.standalone = true
    }
  }

  // Optional custom sidebar link driven by Custom Link Settings.
  if (settingEnabled(settings["customlink.enabled"], false) && settings["customlink.url"]) {
    navItems.push({
      label: settings["customlink.label"] || "Custom Link",
      href: settings["customlink.url"]!,
      icon: <ExternalLink className="size-4" />,
      external: true,
      openInNewTab: settingEnabled(settings["customlink.open_new_tab"], true),
    })
  }

  // Business-line modules (not stored in the modules table) sit at the very
  // bottom of the sidebar. Each honours its `module.<slug>` toggle, the plan
  // gate and its permission-matrix row.
  return mergeBusinessLineModules(navItems, {
    isEnabled: (slug) => settingEnabled(settings[`module.${slug}`]),
    planGate,
    canAccess,
    buildChildren,
  })
}

/**
 * Registers the business-line modules exactly once, at the bottom of the
 * sidebar. Any generic item for the same module (e.g. a `modules` table row,
 * matched by route, slug variant or label regardless of casing) is removed and
 * replaced by the canonical BUSINESS_LINE_MODULES entry, so a DB row can never
 * duplicate a business line or swallow the Publishing → Alt Text submenu. A
 * disabled / plan-locked / denied business line removes those items too.
 */
export function mergeBusinessLineModules(
  navItems: NavItem[],
  gates: {
    isEnabled: (slug: string) => boolean
    planGate: (slug: string) => boolean
    canAccess: (feature: string) => boolean
    buildChildren: (nodes: FeatureChild[]) => NavChild[]
  },
): NavItem[] {
  const normalizeKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "")
  const normalizeHref = (href: string) => href.split(/[?#]/)[0].replace(/\/+$/, "").toLowerCase()

  const result = [...navItems]
  const registered: NavItem[] = []
  for (const entry of BUSINESS_LINE_MODULES) {
    const entryHref = normalizeHref(entry.href)
    const entryKey = normalizeKey(entry.slug)
    const isSameModule = (item: NavItem) => {
      if (item.external) return false
      const href = normalizeHref(item.href)
      const segments = href.split("/").filter(Boolean)
      const isModuleRoot = segments.length === 2 && segments[0] === "modules"
      return (
        href === entryHref ||
        (isModuleRoot && normalizeKey(segments[1]) === entryKey) ||
        normalizeKey(item.label) === normalizeKey(entry.label)
      )
    }

    // Drop every generic / duplicate registration (any casing, slug variant or
    // trailing slash) so the canonical entry below is the only one rendered.
    for (let i = result.length - 1; i >= 0; i--) {
      if (isSameModule(result[i])) result.splice(i, 1)
    }

    const children = entry.children ? gates.buildChildren(entry.children) : undefined
    const visible =
      gates.isEnabled(entry.slug) &&
      gates.planGate(entry.slug) &&
      (entry.children ? (children?.length ?? 0) > 0 : gates.canAccess(entry.feature))
    if (!visible) continue

    // Standalone so EdTech / BPO / Technology render as their own top-level
    // modules (like Publishing) instead of folding into the Communication group.
    registered.push({ label: entry.label, href: entry.href, icon: entry.icon, standalone: true, ...(children ? { children } : {}) })
  }
  return [...result, ...registered]
}
