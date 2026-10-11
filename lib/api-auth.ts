import "server-only"
import { getSession } from "@/lib/auth"

/** Standalone app: the Publishing module and its features are always enabled for signed-in users. */
export async function requireFeatureInModule(_moduleSlug: string, _featureSlug: string) {
  const session = await getSession()
  if (!session) return { ok: false as const, status: 401 as const, error: "Unauthorized" }
  return { ok: true as const, session }
}
