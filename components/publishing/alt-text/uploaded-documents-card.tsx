"use client"

/**
 * @file components/publishing/alt-text/uploaded-documents-card.tsx
 * @module Publishing · Alt Text
 * @kind React client component
 * @summary Phase 3 Task 4 — persisted document records (newest first) with their
 *   separate security and processing statuses. Read-only; extraction arrives in Task 5.
 */
import { useState } from "react"
import useSWR from "swr"
import { FileText, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { altTextFetcher, documentListUrl } from "@/lib/alt-text/client"
import type { DocumentListResponse, DocumentRecord } from "@/lib/alt-text/document-records"
import { StatusBadge } from "./document-upload-status"

const PAGE_SIZE = 10
const POLL_MS = 5000

const SECURITY: Record<DocumentRecord["securityStatus"], { label: string; tone: "info" | "success" | "warning" | "danger" }> = {
  scanning: { label: "Scanning", tone: "info" },
  clean: { label: "Clean", tone: "success" },
  held: { label: "Held for Review", tone: "warning" },
  quarantined: { label: "Quarantined", tone: "danger" },
}

const PROCESSING: Record<DocumentRecord["processingStatus"], { label: string; tone: "neutral" | "info" | "success" | "danger" }> = {
  pending: { label: "Pending", tone: "neutral" },
  extracting: { label: "Extracting", tone: "info" },
  extracted: { label: "Extracted", tone: "success" },
  partially_extracted: { label: "Partially Extracted", tone: "info" },
  unsupported: { label: "Unsupported", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
}

const formatSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`)
const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })

function DocumentRow({ doc }: { doc: DocumentRecord }) {
  const security = SECURITY[doc.securityStatus]
  const processing = PROCESSING[doc.processingStatus]
  return (
    <TableRow>
      <TableCell className="max-w-64">
        <div className="flex flex-col gap-0.5">
          <span className="truncate font-medium" title={doc.filename}>
            {doc.filename}
          </span>
          <span className="font-mono text-[11px] text-muted-foreground">#{doc.id}</span>
        </div>
      </TableCell>
      <TableCell className="uppercase text-muted-foreground">{doc.documentType}</TableCell>
      <TableCell className="text-muted-foreground">{formatSize(doc.size)}</TableCell>
      <TableCell>
        <StatusBadge tone={security.tone} spinning={doc.securityStatus === "scanning"}>
          {security.label}
        </StatusBadge>
      </TableCell>
      <TableCell>
        <StatusBadge tone={processing.tone}>{processing.label}</StatusBadge>
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        <time dateTime={doc.createdAt}>{dateFmt.format(new Date(doc.createdAt))}</time>
      </TableCell>
    </TableRow>
  )
}

export function UploadedDocumentsCard() {
  const [page, setPage] = useState(1)
  const { data, error, isLoading, mutate } = useSWR<DocumentListResponse>(documentListUrl(page, PAGE_SIZE), altTextFetcher, {
    keepPreviousData: true,
    refreshInterval: (latest) => (latest?.documents.some((d) => d.securityStatus === "scanning" || d.processingStatus === "extracting") ? POLL_MS : 0),
  })
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-base">Uploaded Documents</CardTitle>
        <CardDescription>Documents stored for this workspace. Only verified-clean documents can move on to image extraction.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && !data ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <span>Uploaded documents could not be loaded.</span>
            <Button size="sm" variant="outline" onClick={() => mutate()}>
              <RotateCcw aria-hidden="true" />
              Retry
            </Button>
          </div>
        ) : isLoading && !data ? (
          <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading uploaded documents">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : !data || data.documents.length === 0 ? (
          <Empty className="border border-dashed py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileText aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No documents yet</EmptyTitle>
              <EmptyDescription>Uploaded documents appear here once they reach secure storage.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Security</TableHead>
                    <TableHead>Processing</TableHead>
                    <TableHead>Uploaded</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.documents.map((doc) => (
                    <DocumentRow key={doc.id} doc={doc} />
                  ))}
                </TableBody>
              </Table>
            </div>
            {totalPages > 1 && (
              <nav aria-label="Uploaded documents pages" className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  Page {page} of {totalPages} · {data.total} documents
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              </nav>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
