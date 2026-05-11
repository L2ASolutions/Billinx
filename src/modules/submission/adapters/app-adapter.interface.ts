import { SubmissionRequest, SubmissionResult } from "../../../../packages/types/submission";

export interface AppAdapter {
  readonly adapterKey: string;
  readonly adapterName: string;

  /**
   * Submit an invoice to FIRS via this APP provider.
   * Returns a SubmissionResult indicating success or failure.
   */
  submit(request: SubmissionRequest): Promise<SubmissionResult>;

  /**
   * Check the status of a previously submitted invoice.
   * Used for polling when the APP provider is async.
   */
  checkStatus(platformIrn: string, tenantCredential: Record<string, unknown>): Promise<SubmissionResult>;

  /**
   * Verify connectivity to the APP provider.
   * Used for health checks.
   */
  ping(): Promise<boolean>;
}