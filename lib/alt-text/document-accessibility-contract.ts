/** Export provenance is metadata, not native picture content or accessibility certification. */
export type DocumentEvidenceReference={id:string;kind:string;version:number;regionId:string|null;recordedState:string|null}
export type DocumentAccessibilitySnapshot={
 schemaVersion:1;documentId:number;occurrenceId:number;assetId:number;sourceLocator:string;approvedVersionId:number;approvedVersion:number;
 fingerprint:string;generation:{sourceSha256:string|null;regionAnalysisId:string|null;strategy:string|null;references:DocumentEvidenceReference[];omittedReferences:number}|null;
 qa:{id:number;version:number;runId:string;ruleVersion:string;contentVersion:number;blockingFailures:number;manualReview:number;matchesApprovedVersion:boolean;freshness:"not_recomputed"}|null;
 warnings:string[];nativeContent:"approved_short_alt_only";structuredEvidenceEmbedded:false;longDescriptionRetainedInErp:true;conformance:"not_verified"
}
export type DocumentAccessibilitySummary={schemaVersion:1;capturedOccurrences:number;withGenerationEvidence:number;withQa:number;recordedQaBlockers:number;qaMissingOrDifferentVersion:number;omittedReferences:number;structuredEvidenceEmbedded:false;conformance:"not_verified"}
