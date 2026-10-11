import "server-only"
import type { PermissionScope } from "@/lib/permission-model"

type Role = string

const ADMIN_ONLY_ACTIONS = new Set(["manage_settings"])

/** Every member works on the shared organisation library; admins additionally manage settings. */
export async function getScope(_userId: number, _role: Role, _resource: string, _action: string): Promise<PermissionScope> {
  return "all"
}

export async function getActionScope(userId: number, role: Role, resource: string, action: string): Promise<PermissionScope> {
  return (await hasActionGrant(userId, role, resource, action)) ? "all" : "none"
}

export async function hasActionGrant(_userId: number, role: Role, _resource: string, action: string): Promise<boolean> {
  return !ADMIN_ONLY_ACTIONS.has(action) || role === "admin"
}
