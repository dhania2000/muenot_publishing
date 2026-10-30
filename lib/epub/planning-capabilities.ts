import "server-only"
export function epubPlanningCapabilities(){return {candidatePlanning:process.env.EPUB_EXPERIMENTAL_34_PLANNING_ENABLED==="true",conversionEngine:false,standards:{stable:"https://www.w3.org/TR/2026/REC-epub-33-20260113/",candidate:"https://www.w3.org/TR/2026/CRD-epub-34-20261028/",verifiedOn:"2026-10-30"}}}
