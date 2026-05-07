const BACKEND_URL =
  (typeof process !== "undefined" && process.env?.BACKEND_URL) ?? "http://localhost:3001";

export async function post<TResponse>(path: string, body: unknown): Promise<TResponse> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text}`);
  }

  return res.json() as Promise<TResponse>;
}
