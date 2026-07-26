import { z } from "zod";

/**
 * WhatsApp Cloud API adapter (business-initiated template messages).
 *
 * Business-initiated messages MUST use a Meta-approved template; free-form
 * text is only allowed inside a 24h customer-service window. The reminder
 * template this adapter targets takes four body parameters:
 *   {{1}} customer name, {{2}} invoice number, {{3}} amount, {{4}} pay link.
 * Create it in Meta Business Manager under the name in WHATSAPP_TEMPLATE_NAME.
 *
 * dry_run performs no network I/O so the pipeline can run before Meta
 * business verification completes.
 */

const GRAPH_BASE = "https://graph.facebook.com/v20.0";
const REQUEST_TIMEOUT_MS = 10_000;

const SendResponseSchema = z.object({
  messages: z.array(z.object({ id: z.string().min(1) })).min(1),
});

export class WhatsAppError extends Error {
  override name = "WhatsAppError";
}

export interface WhatsAppSender {
  readonly mode: "off" | "dry_run" | "live";
  /** Returns "sent" | "skipped_dry_run"; throws WhatsAppError on hard failure. */
  sendReminderTemplate(
    toE164: string,
    params: { customerName: string; invoiceNumber: string; amount: string; payUrl: string },
  ): Promise<"sent" | "skipped_dry_run">;
}

export function createWhatsAppSender(config: {
  mode: "off" | "dry_run" | "live";
  token: string | undefined;
  phoneNumberId: string | undefined;
  templateName: string;
  templateLang: string;
}): WhatsAppSender {
  return {
    mode: config.mode,
    async sendReminderTemplate(toE164, params): Promise<"sent" | "skipped_dry_run"> {
      if (config.mode === "off") {
        throw new WhatsAppError("WhatsApp sending is not enabled");
      }
      if (config.mode === "dry_run") {
        return "skipped_dry_run";
      }
      if (!config.token || !config.phoneNumberId) {
        throw new WhatsAppError("WhatsApp misconfigured"); // unreachable given config validation
      }

      const body = {
        messaging_product: "whatsapp",
        to: toE164.replace(/^\+/, ""),
        type: "template",
        template: {
          name: config.templateName,
          language: { code: config.templateLang },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: params.customerName },
                { type: "text", text: params.invoiceNumber },
                { type: "text", text: params.amount },
                { type: "text", text: params.payUrl },
              ],
            },
          ],
        },
      };

      let response: Response;
      try {
        response = await fetch(`${GRAPH_BASE}/${config.phoneNumberId}/messages`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        throw new WhatsAppError(
          err instanceof Error && err.name === "TimeoutError"
            ? "WhatsApp API timed out"
            : "could not reach the WhatsApp API",
        );
      }
      if (!response.ok) {
        // Error bodies can include account details; surface only the status.
        throw new WhatsAppError(`WhatsApp API returned HTTP ${response.status}`);
      }
      const parsed = SendResponseSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) throw new WhatsAppError("unexpected response from the WhatsApp API");
      return "sent";
    },
  };
}
