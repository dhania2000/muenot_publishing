export type UploadLimits = { maxBytes: number; maxMb: number; extensions: string[]; mimeTypes: Set<string> }

const BLOCKED_EXTENSIONS = ["exe", "dll", "bat", "cmd", "com", "msi", "scr", "ps1", "sh", "js", "vbs", "jar", "php", "html", "htm", "svg"]
const UPLOAD_NAME_RE = /[\u0000-\u001f<>:"|?*\\/]/

export async function getUploadLimits(): Promise<UploadLimits> {
  const maxMb = Number(process.env.MAX_UPLOAD_MB) || 50
  return {
    maxMb,
    maxBytes: maxMb * 1024 * 1024,
    extensions: ["png", "jpg", "jpeg", "webp", "gif", "pdf", "pptx", "docx"],
    mimeTypes: new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]),
  }
}

/** Byte-level safety floor: rejects unsafe names and executable content regardless of the declared type. */
export async function validateUploadContent(file: Blob & { name?: string | null }): Promise<string | null> {
  const name = (file.name ?? "").trim()
  if (name.length > 255 || UPLOAD_NAME_RE.test(name)) return "File name is invalid"
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : ""
  if (ext && BLOCKED_EXTENSIONS.includes(ext)) return `.${ext} files are not allowed`
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  if (head[0] === 0x4d && head[1] === 0x5a) return "Executable files are not allowed"
  if (head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46) return "Executable files are not allowed"
  return null
}
