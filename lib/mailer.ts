import "server-only"

type Mail = { to: string; subject: string; text: string; html: string }

/**
 * Sends via Resend's REST API when RESEND_API_KEY and EMAIL_FROM are set.
 * Without them (local/dev), the message is written to the server log so the
 * flow stays testable; nothing is ever exposed to the browser.
 */
export async function sendMail(mail: Mail, options: { requireConfiguration?: boolean; idempotencyKey?: string; signal?: AbortSignal } = {}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM
  if (!apiKey || !from) {
    if (options.requireConfiguration) throw new Error("MAIL_NOT_CONFIGURED")
    console.warn(`[mail] RESEND_API_KEY/EMAIL_FROM not set. Email to ${mail.to} not sent.\n${mail.text}`)
    return
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}) },
    signal: options.signal,
    body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
  })
  if (!res.ok) throw new Error(`Resend responded ${res.status}`)
}
