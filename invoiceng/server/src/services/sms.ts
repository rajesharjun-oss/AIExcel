import { z } from "zod";
import type { SmsSender } from "./reminders.js";

/**
 * Termii SMS adapter (Nigerian SMS provider).
 * dry_run performs no network I/O and reports "skipped_dry_run" so the
 * reminder pipeline is observable before an API key exists.
 */

const TERMII_BASE = "https://api.ng.termii.com";
const REQUEST_TIMEOUT_MS = 10_000;

const SendResponseSchema = z.object({ message_id: z.string().min(1) });

export class SmsError extends Error {
  override name = "SmsError";
}

export function createSmsSender(
  mode: "off" | "dry_run" | "live",
  apiKey: string | undefined,
  senderId: string | undefined,
): SmsSender {
  return {
    async send(toE164: string, message: string): Promise<"sent" | "skipped_dry_run"> {
      if (mode === "off" || mode === "dry_run") {
        return "skipped_dry_run";
      }
      if (!apiKey || !senderId) throw new SmsError("SMS misconfigured"); // unreachable given config validation

      let response: Response;
      try {
        response = await fetch(`${TERMII_BASE}/api/sms/send`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            to: toE164,
            from: senderId,
            sms: message,
            type: "plain",
            channel: "generic",
            api_key: apiKey,
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        throw new SmsError(
          err instanceof Error && err.name === "TimeoutError"
            ? "SMS provider timed out"
            : "could not reach SMS provider",
        );
      }
      if (!response.ok) {
        throw new SmsError(`SMS provider returned HTTP ${response.status}`);
      }
      const parsed = SendResponseSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) throw new SmsError("unexpected response from SMS provider");
      return "sent";
    },
  };
}
