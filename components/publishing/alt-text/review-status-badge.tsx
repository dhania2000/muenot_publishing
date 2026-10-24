import { DESCRIPTION_REVIEW_LABEL, type DescriptionReviewStatus } from "@/lib/alt-text/document-approval-contract"
import { Badge } from "@/components/ui/badge"

const TONE: Record<DescriptionReviewStatus, string> = {
  not_reviewed: "border-slate-200 bg-slate-50 text-slate-700",
  in_review: "border-sky-200 bg-sky-50 text-sky-800",
  changes_requested: "border-amber-200 bg-amber-50 text-amber-800",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-800",
  rejected: "border-red-200 bg-red-50 text-red-800",
}

export function ReviewStatusBadge({ status }: { status: DescriptionReviewStatus }) {
  return (
    <Badge variant="outline" className={TONE[status]}>
      {DESCRIPTION_REVIEW_LABEL[status]}
    </Badge>
  )
}
