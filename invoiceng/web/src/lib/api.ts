export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields?: ReadonlyArray<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Thrown when the network itself fails (offline, timeout, server down). */
export class NetworkError extends Error {
  override name = "NetworkError";
  constructor() {
    super("Could not reach the server. Check your connection and try again.");
  }
}

const TIMEOUT_MS = 15_000;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      credentials: "include",
      headers: { "content-type": "application/json", ...init.headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new NetworkError();
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (body ?? {}) as { error?: string; fields?: Array<{ path: string; message: string }> };
    throw new ApiError(res.status, err.error ?? "Request failed", err.fields);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(
      path,
      data === undefined ? { method: "POST" } : { method: "POST", body: JSON.stringify(data) },
    ),
  patch: <T>(path: string, data: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(data) }),
};

export interface Me {
  userId: string;
  businessId: string;
  name: string;
  phone: string;
  businessName: string;
  chargesVat: boolean;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  createdAt: number;
}

export type InvoiceStatus = "draft" | "sent" | "part_paid" | "paid" | "void";

export interface Invoice {
  id: string;
  customerId: string;
  number: string;
  status: InvoiceStatus;
  issueDate: number;
  dueDate: number;
  subtotalKobo: number;
  vatKobo: number;
  totalKobo: number;
  paidKobo: number;
  shareToken: string;
  notes: string | null;
}

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPriceKobo: number;
  lineTotalKobo: number;
}

export interface InvoicePayment {
  id: string;
  amountKobo: number;
  method: "cash" | "transfer" | "paystack";
  reference: string | null;
  paidAt: number;
}

export interface OutboxReminder {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  seq: number;
  scheduledFor: number;
  waLink: string | null;
  message: string;
}

export interface ReminderSettings {
  enabled: boolean;
  daysBeforeDue: number;
  everyNDaysAfterDue: number;
  maxAfterDueCount: number;
}

export interface PublicInvoice {
  number: string;
  status: InvoiceStatus;
  issueDate: number;
  dueDate: number;
  subtotalKobo: number;
  vatKobo: number;
  totalKobo: number;
  paidKobo: number;
  notes: string | null;
  businessName: string;
  customerName: string;
  items: InvoiceItem[];
  paymentsEnabled: boolean;
}
