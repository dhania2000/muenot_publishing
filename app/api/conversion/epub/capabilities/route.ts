import {getSession} from "@/lib/auth"
import {epubPlanningCapabilities} from "@/lib/epub/planning-capabilities"
export const dynamic="force-dynamic"
export async function GET(){const actor=await getSession();return Response.json(actor?{success:true,...epubPlanningCapabilities()}:{success:false},{status:actor?200:401,headers:{"Cache-Control":"private, no-store"}})}
