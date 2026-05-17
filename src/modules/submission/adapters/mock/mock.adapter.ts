import { Injectable, Logger } from '@nestjs/common';
import { AppAdapter } from '../app-adapter.interface';
import {
  SubmissionRequest,
  SubmissionResult,
} from '../../../../../packages/types/submission';
import * as crypto from 'crypto';

@Injectable()
export class MockAdapter implements AppAdapter {
  readonly adapterKey = 'mock';
  readonly adapterName = 'Mock FIRS Adapter (Sandbox)';

  private readonly logger = new Logger(MockAdapter.name);

  // Simulate a 90% acceptance rate in sandbox
  private readonly ACCEPTANCE_RATE = 0.9;

  async submit(request: SubmissionRequest): Promise<SubmissionResult> {
    this.logger.log(
      `[MockAdapter] Submitting invoice ${request.platformIrn} to mock FIRS`,
    );

    // Simulate network delay
    await this.delay(800 + Math.random() * 1200);

    // Simulate occasional failures
    if (Math.random() > this.ACCEPTANCE_RATE) {
      this.logger.warn(
        `[MockAdapter] Simulated FIRS rejection for ${request.platformIrn}`,
      );
      return {
        success: false,
        errorCode: 'FIRS-ERR-4021',
        errorMessage:
          'Invalid or unregistered Buyer TIN. The TIN provided does not match any registered taxpayer in the FIRS database.',
        retryable: false,
      };
    }

    // Generate mock FIRS confirmed IRN and CSID
    const firsConfirmedIrn = this.generateFirsIrn(request.platformIrn);
    const csid = this.generateCsid();
    const qrCodeBase64 = this.generateMockQrCode(firsConfirmedIrn);

    this.logger.log(
      `[MockAdapter] Invoice ${request.platformIrn} accepted. FIRS IRN: ${firsConfirmedIrn}`,
    );

    return {
      success: true,
      firsConfirmedIrn,
      csid,
      qrCodeBase64,
      rawResponse: {
        status: 'ACCEPTED',
        firsIrn: firsConfirmedIrn,
        csid,
        timestamp: new Date().toISOString(),
        accessPoint: 'MockAdapter/Sandbox',
      },
    };
  }

  async checkStatus(
    platformIrn: string,
    tenantCredential: Record<string, unknown>,
  ): Promise<SubmissionResult> {
    await this.delay(300);
    return {
      success: true,
      firsConfirmedIrn: this.generateFirsIrn(platformIrn),
      rawResponse: { status: 'ACCEPTED' },
    };
  }

  async ping(): Promise<boolean> {
    await this.delay(100);
    return true;
  }

  private generateFirsIrn(platformIrn: string): string {
    const parts = platformIrn.split('-');
    const tin = parts[0] ?? 'UNK';
    const date = parts[1] ?? '20260101';
    const uid = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `NGA-MBS-${date.substring(0, 4)}-${date.substring(4, 6)}-${date.substring(6, 8)}-${tin}-${uid}`;
  }

  private generateCsid(): string {
    return `SHA256:${crypto.randomBytes(32).toString('hex')}`;
  }

  private generateMockQrCode(firsIrn: string): string {
    // In production this would be a real QR code image
    // For sandbox we return a base64 placeholder
    return Buffer.from(
      `BILLINX_QR|${firsIrn}|${new Date().toISOString()}`,
    ).toString('base64');
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
