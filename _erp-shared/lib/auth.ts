/**
 * @file lib/auth.ts
 * @module Authentication & Sessions
 * @kind Server-side library
 * @summary Authentication & Sessions domain logic (SESSION_COOKIE, SessionPayload, createSessionToken, verifySessionToken, …).
 * @exports SESSION_COOKIE, SessionPayload, createSessionToken, verifySessionToken, getSession, setSessionCookie, clearSessionCookie
 * @usedBy app/(marketing)/layout.tsx, app/(workspace)/assistant/page.tsx, app/(workspace)/dashboard/page.tsx, app/(workspace)/inbox/page.tsx, app/(workspace)/layout.tsx (+764 more); 50 test files
 * @see docs/CODEBASE-GUIDE.md for module ownership, conventions and where to add new code.
 */
import { SignJWT, jwtVerify } from "jose"
import { getSessionSecretKey } from "@/lib/session-secret"
import { cookies, headers } from "next/headers"
import { clientIpFromHeaders } from "@/lib/client-ip"
import { setCurrentActor } from "./actor-context"
import { initializeSessionTenantContext, setCurrentTenant } from "./tenant-context"
import { isSessionActive, touchSession } from "./session-store"
import { isImpersonationWindowOpen } from "./impersonation-window"

export const SESSION_COOKIE = "ems_session"
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7 // 7 days

function getSecretKey() {
  // Shared with proxy.ts; fails closed in production when SESSION_SECRET is unset.
  return getSessionSecretKey()
}

export type SessionPayload = {
  userId: number
  email: string
  name: string
  role: "admin" | "employee"
  /**
   * The tenant this user belongs to, captured at login from users.tenant_id.
   * Optional so JWTs issued before the multi-tenant rollout still verify;
   * `getSession()` backfills the default tenant for those legacy tokens.
   */
  tenantId?: number
  /**
   * platform/tenant role axes, captured at login from the DB. Optional
   * so pre- tokens still verify; guards re-resolve from the DB source of
   * truth (lib/platform-roles.ts) rather than trusting these for authorization.
   * They are carried in the token only for cheap, allocation-free UI hints.
   */
  platformRole?: "none" | "platform_staff" | "platform_super_admin"
  tenantRole?: "employee" | "module_admin" | "tenant_admin" | "tenant_owner"
  /**
   * The customer tenant a platform operator has EXPLICITLY entered. Set only by
   * the audited impersonation endpoint, which re-mints the token; never accepted
   * from client input. When present, `getSession()` scopes the data layer to
   * this tenant instead of the operator's home tenant.
   */
  impersonatedTenantId?: number | null
  /**
   * Epoch-ms hard expiry of the impersonation window (Spec47). Signed with
   * the token; an impersonation without a future expiry is ignored (fails
   * closed to the home tenant), so a legacy or leftover field can never keep an
   * operator inside a customer tenant.
   */
  impersonationExpiresAt?: number | null
  /**
   * Spec51 — the tenant-approved support request backing this impersonation,
   * and its access mode. `getSession()` re-checks the grant every request so a
   * tenant revocation or expiry ends the support session immediately. A
   * missing mode is treated as read-only by the proxy.
   */
  supportRequestId?: number | null
  impersonationMode?: "read_only" | "read_write" | null
  /**
   * The organization a MULTI-ORG user has actively switched into. Unlike
   * `impersonatedTenantId` (a platform-operator concept), this is available to
   * any user and is only ever honored for a tenant the user holds an ACTIVE
   * membership in (lib/tenant-membership.ts). It is set solely by the audited
   * organization switcher, which re-mints the token after validating membership;
   * `getSession()` re-validates it against live membership on every request, so
   * a revoked membership or a forged/stale field falls closed to the home
   * tenant. Null / absent means the session is scoped to the home tenant.
   */
  activeTenantId?: number | null
  /**
   * opaque session id (jti) that keys the server-side session
   * record in lib/session-store.ts. Optional so tokens issued before the
   * session store existed still verify — `getSession()` treats a missing
   * `sid` as always-active (nothing to revoke it against) rather than
   * failing every pre-existing login.
   */
  sid?: string
  /**
   * Request-scoped, NEVER signed into a token: the tenant this request is
   * verified to act in (home, a re-validated switched org, or a live
   * impersonation). Set by `getSession()`; read it via lib/tenant-access.ts.
   * `tenantId` above stays the HOME tenant (session store, auth audit).
   */
  effectiveTenantId?: number
  tenantAccessMode?: "home" | "switched" | "impersonating"
}

export async function createSessionToken(
  payload: SessionPayload,
  durationSeconds: number = SESSION_DURATION_SECONDS,
) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${durationSeconds}s`)
    .sign(getSecretKey())
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey())
    return payload as unknown as SessionPayload
  } catch {
    return null
  }
}

async function currentRequestIp(): Promise<string | null> {
  try {
    return clientIpFromHeaders(await headers())
  } catch {
    return null
  }
}

/** Server Component / Route Handler helper — reads the session from cookies(). */
export async function getSession(): Promise<SessionPayload | null> {
  // Must execute synchronously: initializing only after cookies/JWT awaits
  // leaves the calling route outside the tenant context (e.g. WhatsApp status).
  initializeSessionTenantContext()
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (!token) return null
  const session = await verifySessionToken(token)
  if (session) {
    // Runtime-only fields must never be trusted from a token payload.
    delete session.effectiveTenantId
    delete session.tenantAccessMode
    // a cryptographically valid token can still have been revoked
    // (admin-forced sign-out, "sign out all devices", concurrent-session cap).
    // The session store is the live-ness source of truth; a token whose `sid`
    // is missing or revoked there is treated as signed out. Fails open on a
    // store outage so a DB blip never locks everyone out.
    if (session.sid && !(await isSessionActive(session.sid, session.tenantId, await currentRequestIp()))) {
      return null
    }
    if (session.sid) void touchSession(session.sid, session.tenantId)

    // A signed token can outlive a user move or deletion. Re-check the home
    // tenant on every request before binding any tenant/actor context. A
    // mismatch requires a fresh login; never keep granting the old tenant's
    // data merely because a seven-day JWT still verifies. On lookup failure,
    // fail closed rather than trusting the stale claim.
    let tenantId: number | undefined
    try {
      const { resolveTenantIdForUser } = await import("./tenant-service")
      tenantId = (await resolveTenantIdForUser(session.userId)) ?? undefined
    } catch {
      return null
    }
    if (!Number.isSafeInteger(tenantId) || tenantId == null || tenantId <= 0 ||
        (session.tenantId != null && session.tenantId !== tenantId)) return null
    session.tenantId = tenantId

    // Only a verified, live user with a current home tenant can enter the
    // actor and tenant contexts used by subsequent reads and writes.
    setCurrentActor({
      userId: session.userId,
      name: session.name,
      email: session.email,
      role: session.role,
    })
    // when a platform operator is actively impersonating a customer
    // tenant, the data layer must scope to THAT tenant, not their home tenant.
    // The impersonation id is carried in the verified (signed) token and is
    // only ever set by the audited impersonation endpoint. It is honored here
    // only for a genuine platform operator, so a forged/leftover field on a
    // non-platform token can never redirect scoping to another tenant.
    if (
      session.impersonatedTenantId != null &&
      !isImpersonationWindowOpen(session.impersonationExpiresAt, Date.now())
    ) {
      // Expired (or never time-boxed) impersonation: drop it for this request.
      // Downstream guards read the same object, so they also see no impersonation.
      session.impersonatedTenantId = null
      session.impersonationExpiresAt = null
    }
    // Spec51: an impersonation is honored only while its tenant-approved
    // support grant is live. No grant id (legacy token) or a revoked/expired
    // grant drops the impersonation — fails closed to the home tenant.
    if (session.impersonatedTenantId != null) {
      let live = false
      if (typeof session.supportRequestId === "number" && session.platformRole != null && session.platformRole !== "none") {
        try {
          const [{ isSupportGrantLive }, { getStoredRoles }] = await Promise.all([
            import("./support-access-store"), import("./platform-roles"),
          ])
          const stored = await getStoredRoles(session.userId)
          live = Boolean(stored && stored.tenantId === tenantId && stored.platformRole !== "none" &&
            await isSupportGrantLive(session.supportRequestId, session.impersonatedTenantId, session.userId))
        } catch {
          live = false
        }
      }
      if (!live) {
        session.impersonatedTenantId = null
        session.impersonationExpiresAt = null
        session.supportRequestId = null
        session.impersonationMode = null
      }
    }
    let effectiveTenantId =
      session.impersonatedTenantId != null &&
      session.platformRole != null &&
      session.platformRole !== "none"
        ? session.impersonatedTenantId
        : tenantId

    // multi-org switching: a user who has switched into another organization
    // carries `activeTenantId` in the verified token. Platform impersonation
    // (above) always wins; otherwise, when the active tenant differs from the
    // home tenant, it is honored ONLY after re-validating a LIVE active
    // membership. This fails closed to the home tenant if the membership was
    // revoked/suspended or the value is stale/forged, so switching can never
    // outlive access.
    const isImpersonating =
      session.impersonatedTenantId != null &&
      session.platformRole != null &&
      session.platformRole !== "none"
    if (
      !isImpersonating &&
      session.activeTenantId != null &&
      session.activeTenantId !== tenantId
    ) {
      try {
        const { isActiveMembership } = await import("./tenant-membership")
        if (await isActiveMembership(session.userId, session.activeTenantId)) {
          effectiveTenantId = session.activeTenantId
        }
      } catch (err) {
      }
    }

    session.effectiveTenantId = effectiveTenantId
    session.tenantAccessMode = isImpersonating ? "impersonating" : effectiveTenantId !== tenantId ? "switched" : "home"
    if (effectiveTenantId != null) {
      setCurrentTenant({ tenantId: effectiveTenantId })
    }
  }
  return session
}

export async function setSessionCookie(token: string, durationSeconds: number = SESSION_DURATION_SECONDS) {
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: durationSeconds,
  })
}

export async function clearSessionCookie() {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE)
}
