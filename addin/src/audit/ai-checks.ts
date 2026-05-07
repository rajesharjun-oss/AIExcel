import type { AuditResult, AuditCheckRequest, AuditCheckResponse } from "@aiexcel/shared";
import { post } from "../shared/api-client";
import { getSheetSnapshot } from "../shared/workbook";

export async function runAiAudit(): Promise<AuditResult[]> {
  const { name, headers, values } = await getSheetSnapshot(100);

  const body: AuditCheckRequest = { sheetName: name, values, headers };
  const response = await post<AuditCheckResponse>("/v1/audit/check", body);
  return response.results;
}
