import "server-only"
import { getSession, type Session } from "@/lib/auth"

/** Same discriminated result as the ERP gate, so Publishing routes map failures identically. */
export type FeatureGateResult =
  | { ok: true; session: Session }
  | { ok: false; status: 401 | 403 | 404; error: string }
  | { ok: false; status: 403; error: string; code: "PLAN_REQUIRED" }

/** Standalone app: the Publishing module and its features are always enabled for signed-in users. */
export async function requireFeatureInModule(_moduleSlug: string, _featureSlug: string): Promise<FeatureGateResult> {
  const session = await getSession()
  if (!session) return { ok: false, status: 401, error: "Unauthorized" }
  return { ok: true, session }
}
