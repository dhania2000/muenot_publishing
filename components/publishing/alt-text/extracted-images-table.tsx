"use client"

/**
 * @file components/publishing/alt-text/extracted-images-table.tsx
 * @module Publishing
 * @kind React client component
 * @summary Compact table view over the same page of occurrences as the gallery.
 */
import { MoreHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { existingAltText, type ReviewImageRecord } from "@/lib/alt-text/document-image-review"
import { DuplicateIndicator, type ImageRowActions } from "./extracted-images-gallery"
import { ContextBadge, ExtractionBadge, ImageThumb, ReviewBadge, SelectCheckbox, imageTypeLabel, locationLabel, sourceName } from "./image-review-ui"

const COLUMNS = ["Image / Source Name", "Original Document", "Location", "Image Type", "Existing Alt Text", "Context", "Review"]

export function ExtractedImagesTable({ images, actions, pageHeader }: { images: ReviewImageRecord[]; actions: ImageRowActions; pageHeader: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">{pageHeader}</TableHead>
            <TableHead className="w-14">
              <span className="sr-only">Thumbnail</span>
            </TableHead>
            {COLUMNS.map((c) => (
              <TableHead key={c} className="whitespace-nowrap">
                {c}
              </TableHead>
            ))}
            <TableHead className="w-12">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {images.map((img) => {
            const alt = existingAltText(img)
            return (
              <TableRow key={img.id} data-state={img.selected ? "selected" : undefined}>
                <TableCell>
                  <SelectCheckbox img={img} pending={actions.pendingIds.has(img.id)} disabled={!actions.canManage} onChange={(v) => actions.onToggle(img, v)} />
                </TableCell>
                <TableCell>
                  <ImageThumb img={img} className="size-10 rounded" />
                </TableCell>
                <TableCell className="max-w-56">
                  <div className="flex flex-col gap-0.5">
                    <span className="truncate font-medium" title={sourceName(img)}>
                      {sourceName(img)}
                    </span>
                    <span className="truncate font-mono text-[11px] text-muted-foreground" title={img.sourceLocator}>
                      {`#${img.id} · ${img.sourceLocator}`}
                    </span>
                    <DuplicateIndicator img={img} onClick={() => actions.onDuplicates(img)} />
                  </div>
                </TableCell>
                <TableCell className="max-w-44 truncate text-xs" title={img.documentFilename}>
                  {img.documentFilename}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs">{locationLabel(img)}</TableCell>
                <TableCell className="whitespace-nowrap text-xs">
                  <div className="flex flex-col gap-1">
                    {imageTypeLabel(img)}
                    {img.extractionStatus !== "extracted" && <ExtractionBadge img={img} />}
                  </div>
                </TableCell>
                <TableCell className="max-w-60 text-xs text-muted-foreground">{alt ? <span className="line-clamp-2 text-foreground">{alt}</span> : "None in source"}</TableCell>
                <TableCell>
                  <ContextBadge img={img} />
                </TableCell>
                <TableCell>
                  <ReviewBadge img={img} />
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-8">
                        <MoreHorizontal aria-hidden="true" />
                        <span className="sr-only">{`Actions for ${sourceName(img)}`}</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => actions.onDetails(img)}>Preview</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => actions.onContext(img)}>View context</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => actions.onDetails(img)} disabled={!alt}>
                        View existing alt text
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={!actions.canManage || actions.pendingIds.has(img.id) || (!img.selected && !img.eligibility.eligible)}
                        onSelect={() => actions.onToggle(img, !img.selected)}
                      >
                        {img.selected ? "Deselect" : "Select"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
