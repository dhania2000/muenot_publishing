import "server-only"
import { query } from "@/lib/db"
import { currentTenantId } from "@/lib/tenant-scope"

export type QuotaDecision = { allowed: boolean; overQuota: boolean; reason: string; usedBytes: number; quotaBytes: number | null }

export async function checkStorageQuota(incomingBytes: number): Promise<QuotaDecision> {
  const quotaGb = Number(process.env.STORAGE_QUOTA_GB) || 0
  if (!quotaGb) return { allowed: true, overQuota: false, reason: "", usedBytes: 0, quotaBytes: null }
  const quotaBytes = quotaGb * 1024 ** 3
  const rows = await query<any[]>("SELECT COALESCE(SUM(size_bytes),0) AS used FROM app_files WHERE tenant_id = ? AND upload_status <> 'deleted'", [currentTenantId()])
  const usedBytes = Number(rows[0]?.used ?? 0)
  const overQuota = usedBytes + incomingBytes > quotaBytes
  return { allowed: !overQuota, overQuota, reason: overQuota ? "Your organisation has reached its storage quota." : "", usedBytes, quotaBytes }
}
