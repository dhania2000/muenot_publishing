/** Task 8: unverified recognition evidence. No formula validation, MathML or automatic approval. */
import type { ImageRegion, NormalizedBox, RegionAnalysis } from "./region-analysis"
import { isValidNormalizedBox } from "./region-analysis"
import { regionCrop, type OcrPixelBox } from "./ocr-contract"

export const MATH_SCHEMA_VERSION = 1
export const MATH_LIMITS = { sourcePixels: 25_000_000, cropPixels: 4_000_000, cropBytes: 5_000_000, outputChars: 12_000, timeoutMs: 90_000 } as const
export type MathRequest = { requestId: string; occurrenceId: number | null; analysisId: string; regionId: string; reprocess: boolean }
export function parseMathRequest(raw: unknown): MathRequest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const b = raw as Record<string,unknown>
  if (Object.keys(b).some((k) => !["requestId","occurrenceId","analysisId","regionId","reprocess"].includes(k))) return null
  if (typeof b.requestId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(b.requestId) || typeof b.analysisId !== "string" || !/^rga_[a-f0-9]{8,40}$/.test(b.analysisId) || typeof b.regionId !== "string" || !/^rgn_[a-f0-9]{8,32}$/.test(b.regionId)) return null
  if (b.occurrenceId != null && (!Number.isSafeInteger(b.occurrenceId) || Number(b.occurrenceId) <= 0)) return null
  if (b.reprocess != null && typeof b.reprocess !== "boolean") return null
  return { requestId:b.requestId,occurrenceId:b.occurrenceId==null?null:Number(b.occurrenceId),analysisId:b.analysisId,regionId:b.regionId,reprocess:b.reprocess===true }
}
export type MathCrop = { analysisId:string; analysisVersion:number; regionId:string; normalizedBox:NormalizedBox; pixelBox:OcrPixelBox; sourceWidth:number;sourceHeight:number;sourceSha256:string;coordinateSystem:"stored_pixels_top_left";locationIsEstimate:true }
export function equationCrop(region:ImageRegion, analysis:Pick<RegionAnalysis,"source">, width:number, height:number):OcrPixelBox|null {
  if (region.primaryType!=="equation_region" || region.locationStatus!=="verified_frame" || analysis.source.orientation!==1 || analysis.source.orientationUnknown || analysis.source.storedWidth!==width || analysis.source.storedHeight!==height || !isValidNormalizedBox(region.box)) return null
  const crop=regionCrop(region.box,width,height)
  return crop && crop.width*crop.height<=MATH_LIMITS.cropPixels?crop:null
}
export type MathRecognitionResult = {
  schemaVersion:1;analysisId:string;assetId:number;occurrenceId:number|null;regionId:string;source:MathCrop
  providerId:"mixtex_transformers_cpu";modelId:string;modelRevision:string;weightsSha256:string
  rawOutput:string;candidateLatex:string|null;confidence:null;confidenceBasis:"not_reported"
  status:"candidate"|"no_expression_detected"|"incomplete";warnings:string[];verified:false;untrustedSource:true;durationMs:number;createdAt:string
  preprocessing:MathEngineOutput["preprocessing"];generation:MathEngineOutput["generation"]
}
export type MathEngineOutput = {schemaVersion:1;rawOutput:string;modelId:string;revision:string;weightsSha256:string;confidence:null;confidenceBasis:"not_reported";durationMs:number;preprocessing:{version:string;width:number;height:number;scale:number;offsetX:number;offsetY:number};generation:{maxNewTokens:number;numBeams:number;doSample:boolean;truncated:boolean}}
export function parseMathEngineOutput(raw:unknown, model:{modelId:string;revision:string;weightsSha256:string}):MathEngineOutput|null {
  if (!raw || typeof raw!=="object")return null
  const r=raw as Record<string,unknown>
  if (r.schemaVersion!==1 || typeof r.rawOutput!=="string" || r.rawOutput.length>MATH_LIMITS.outputChars || r.modelId!==model.modelId || r.revision!==model.revision || r.weightsSha256!==model.weightsSha256 || r.confidence!==null || r.confidenceBasis!=="not_reported" || typeof r.durationMs!=="number" || !Number.isFinite(r.durationMs) || r.durationMs<0)return null
  const p=r.preprocessing as MathEngineOutput["preprocessing"],g=r.generation as MathEngineOutput["generation"]
  if(!p||p.version!=="white-fit-half-v1"||p.width!==500||p.height!==400||!Number.isFinite(p.scale)||p.scale<=0||p.scale>0.5||p.offsetX!==10||p.offsetY!==10||!g||g.maxNewTokens!==384||g.numBeams!==1||g.doSample!==false||typeof g.truncated!=="boolean")return null
  return r as MathEngineOutput
}
export type MathEvidenceRecord={id:number;version:number;regionId:string;status:"queued"|"recognizing"|"candidate"|"no_expression_detected"|"incomplete"|"failed"|"cancelled";jobId:number|null;errorCode:string|null;result:MathRecognitionResult|null;createdAt:string}
export type MathResponse={success:true;assetId:number;occurrenceId:number|null;available:boolean;enabled:boolean;reason:string|null;canRun:boolean;regions:{id:string;analysisId:string;label:string;box:NormalizedBox;eligible:boolean}[];results:MathEvidenceRecord[];activeJobs:boolean}
