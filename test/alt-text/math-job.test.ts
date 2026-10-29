import {beforeEach,describe,it,expect,vi} from "vitest"
import type {BackgroundJob} from "@/lib/background-jobs"
const d=vi.hoisted(()=>({work:vi.fn(),write:vi.fn(),cancel:vi.fn(),query:vi.fn(),policy:vi.fn(),source:vi.fn(),recognize:vi.fn(),authorize:vi.fn(async()=>({viewScope:"added"}))}))
vi.mock("@/lib/db",()=>({query:d.query}))
vi.mock("@/lib/background-jobs",()=>({isBackgroundJobCancelRequested:d.cancel}))
vi.mock("@/lib/alt-text/math-store",()=>({getMathWork:d.work,writeMathState:d.write}))
vi.mock("@/lib/alt-text/math-engine",()=>({MATH_MODEL:{revision:"pinned"},recognizeMath:d.recognize,MathEngineError:class extends Error{}}))
vi.mock("@/lib/alt-text/math-service",()=>({mathPolicy:d.policy,resolveEquationSource:d.source,authorizeMathWorker:d.authorize,MathRequestError:class extends Error{}}))
const {runMathRecognitionJob,cropEquationImage}=await import("@/lib/alt-text/math-job")
const {createCanvas}=await import("@napi-rs/canvas")
const job={id:11,tenant_id:5,worker_id:"a"} as BackgroundJob
const run=()=>runMathRecognitionJob({evidenceId:1},{job,signal:new AbortController().signal})
beforeEach(()=>{vi.clearAllMocks();d.work.mockResolvedValue({row:{status:"queued",analysis_id:"math_123"},input:{assetId:1,occurrenceId:2,actorId:3,request:{regionId:"rgn_12345678"},source:{pixelBox:{left:0,top:0,width:10,height:10}},modelFingerprint:JSON.stringify({revision:"pinned"})}});d.cancel.mockResolvedValue(false);d.query.mockResolvedValue([{id:11}]);d.policy.mockResolvedValue({enabled:true});d.write.mockResolvedValue(undefined)})
describe("durable isolated equation execution",()=>{
 it("rechecks the current actor before opening private bytes",async()=>{d.authorize.mockRejectedValueOnce(new Error("ACTOR_UNAVAILABLE"));await expect(run()).rejects.toThrow();expect(d.source).not.toHaveBeenCalled();expect(d.recognize).not.toHaveBeenCalled()})
 it("uses the current record view scope instead of granting the worker all images",async()=>{d.source.mockResolvedValue({source:{changed:true},bytes:new Uint8Array()});await expect(run()).rejects.toThrow();expect(d.source.mock.calls[0][3]).toEqual({userId:3,tenantId:5,scope:"added"})})
 it("does not open a private image for a different tenant or mismatched delivery",async()=>{d.work.mockResolvedValue(null);expect(await run()).toEqual({superseded:true});expect(d.source).not.toHaveBeenCalled()})
 it("replays completed evidence without running inference",async()=>{d.work.mockResolvedValue({row:{status:"candidate"}});await run();expect(d.recognize).not.toHaveBeenCalled()})
 it("rejects a stale lease before reading source bytes",async()=>{d.query.mockResolvedValue([]);await expect(run()).rejects.toThrow("MATH_LEASE_LOST");expect(d.source).not.toHaveBeenCalled()})
 it("checks durable cancellation before source access",async()=>{d.cancel.mockResolvedValue(true);await expect(run()).rejects.toThrow("MATH_CANCELLED");expect(d.source).not.toHaveBeenCalled()})
 it("does not recognize a changed source or region",async()=>{d.source.mockResolvedValue({source:{changed:true},bytes:new Uint8Array()});await expect(run()).rejects.toThrow();expect(d.recognize).not.toHaveBeenCalled()})
 it("makes an actual independent crop without changing original pixels",async()=>{
  const canvas=createCanvas(20,10),ctx=canvas.getContext("2d");ctx.fillStyle="red";ctx.fillRect(0,0,10,10);ctx.fillStyle="blue";ctx.fillRect(10,0,10,10)
  const original=await canvas.encode("png"),snapshot=Buffer.from(original),crop=await cropEquationImage(original,{left:10,top:0,width:10,height:10})
  expect(original).toEqual(snapshot);const {loadImage}=await import("@napi-rs/canvas");const decoded=await loadImage(Buffer.from(crop));expect(decoded.width).toBe(10);const target=createCanvas(10,10);target.getContext("2d").drawImage(decoded,0,0);expect([...target.getContext("2d").getImageData(0,0,1,1).data]).toEqual([0,0,255,255])
 })
})
