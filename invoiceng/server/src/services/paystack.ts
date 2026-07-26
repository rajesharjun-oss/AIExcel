import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Paystack adapter.
 * - dry_run: no network calls; initialize returns a fake checkout URL.
 * - live: real API calls with explicit timeouts.
 * Webhook verification is identical in both modes so it can be tested now.
 */

export interface PaystackInitResult {
  readonly authorizationUrl: string;
  readonly reference: string;
  readonly dryRun: boolean;
}

export class PaystackError extends Error {
  override name = "PaystackError";
}

const InitResponseSchema = z.object({
  status: z.literal(true),
  data: z.object({
    authorization_url: z.string().url(),
    reference: z.string().min(1),
  }),
});

export const PaystackChargeEventSchema = z.object({
  event: z.string(),
  data: z.object({
    id: z.union([z.string(), z.number()]).transform(String),
    reference: z.string().min(1),
    amount: z.number().int().nonnegative(),
    currency: z.string(),
    status: z.string(),
    metadata: z
      .object({ invoice_id: z.string().uuid().optional() })
      .passthrough()
      .nullish(),
  }),
});
export type PaystackChargeEvent = z.infer<typeof PaystackChargeEventSchema>;

export interface PaystackClient {
  initializeTransaction(args: {
    email: string;
    amountKobo: number;
    reference: string;
    invoiceId: string;
    callbackUrl: string;
  }): Promise<PaystackInitResult>;
  /** Constant-time HMAC-SHA512 check of the raw webhook body. */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean;
  readonly mode: "off" | "dry_run" | "live";
}

const API_BASE = "https://api.paystack.co";
const REQUEST_TIMEOUT_MS = 10_000;

export function createPaystackClient(
  mode: "off" | "dry_run" | "live",
  secretKey: string | undefined,
  appBaseUrl: string,
): PaystackClient {
  function verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    // In dry_run we accept the literal test signature so the pipeline can be
    // exercised end-to-end without a real key.
    if (mode !== "live") {
      return signatureHeader === "test-signature";
    }
    if (!secretKey || !signatureHeader) return false;
    const expected = createHmac("sha512", secretKey).update(rawBody).digest("hex");
    const given = Buffer.from(signatureHeader, "utf8");
    const want = Buffer.from(expected, "utf8");
    return given.length === want.length && timingSafeEqual(given, want);
  }

  async function initializeTransaction(args: {
    email: string;
    amountKobo: number;
    reference: string;
    invoiceId: string;
    callbackUrl: string;
  }): Promise<PaystackInitResult> {
    if (mode === "off") {
      throw new PaystackError("online payments are not enabled");
    }
    if (mode === "dry_run") {
      return {
        authorizationUrl: `${appBaseUrl}/pay/dry-run/${encodeURIComponent(args.reference)}`,
        reference: args.reference,
        dryRun: true,
      };
    }
    if (!secretKey) throw new PaystackError("missing secret key"); // unreachable given config validation

    let response: Response;
    try {
      response = await fetch(`${API_BASE}/transaction/initialize`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secretKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: args.email,
          amount: args.amountKobo,
          currency: "NGN",
          reference: args.reference,
          callback_url: args.callbackUrl,
          metadata: { invoice_id: args.invoiceId },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new PaystackError(
        err instanceof Error && err.name === "TimeoutError"
          ? "Paystack request timed out"
          : "could not reach Paystack",
      );
    }
    if (!response.ok) {
      // Body may contain account details; log only the status code upstream.
      throw new PaystackError(`Paystack initialize failed with HTTP ${response.status}`);
    }
    const parsed = InitResponseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new PaystackError("unexpected response shape from Paystack");
    }
    return {
      authorizationUrl: parsed.data.data.authorization_url,
      reference: parsed.data.data.reference,
      dryRun: false,
    };
  }

  return { initializeTransaction, verifyWebhookSignature, mode };
}
