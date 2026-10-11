export const PERMISSION_SCOPES = ["none", "all", "added", "owned", "both"] as const
export type PermissionScope = (typeof PERMISSION_SCOPES)[number]
