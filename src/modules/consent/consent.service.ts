import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { Prisma } from '@prisma/client';

type ConsentTypeValue =
  | 'TERMS_AND_PRIVACY'
  | 'NDPR_DATA_PROCESSING'
  | 'BUSINESS_AUTHORISATION';

@Injectable()
export class ConsentService {
  private readonly logger = new Logger(ConsentService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Record a single consent event ─────────────────────────────────────────
  async record(params: {
    email: string;
    userId?: string;
    tenantId?: string;
    consentType: ConsentTypeValue;
    consentVersion?: string;
    ipAddress?: string;
    userAgent?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.asAdmin((tx) =>
      tx.consentRecord.create({
        data: {
          email: params.email,
          userId: params.userId ?? null,
          tenantId: params.tenantId ?? null,
          consentType: params.consentType,
          consentVersion: params.consentVersion ?? '1.0',
          ipAddress: params.ipAddress ?? null,
          userAgent: params.userAgent ?? null,
          metadata: (params.metadata as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
        },
      }),
    );
  }

  // ── List consent records for a specific user ───────────────────────────────
  async listByUser(userId: string) {
    return this.prisma.asAdmin((tx) =>
      tx.consentRecord.findMany({
        where: { userId },
        orderBy: { consentedAt: 'desc' },
      }),
    );
  }

  // ── Admin: list consent records with optional filters ─────────────────────
  async listAll(filters: {
    tenantId?: string;
    email?: string;
    consentType?: string;
  }) {
    return this.prisma.asAdmin((tx) =>
      tx.consentRecord.findMany({
        where: {
          ...(filters.tenantId ? { tenantId: filters.tenantId } : {}),
          ...(filters.email ? { email: filters.email } : {}),
          ...(filters.consentType
            ? { consentType: filters.consentType as ConsentTypeValue }
            : {}),
        },
        orderBy: { consentedAt: 'desc' },
      }),
    );
  }

  // ── Submit a right-to-erasure request ─────────────────────────────────────
  async requestErasure(params: {
    userId: string;
    tenantId: string;
    email: string;
  }): Promise<{ message: string; requestId: string }> {
    // Prevent duplicate pending requests
    const existing = await this.prisma.asAdmin((tx) =>
      tx.erasureRequest.findFirst({
        where: { userId: params.userId, status: 'PENDING' },
      }),
    );
    if (existing) {
      throw new ConflictException(
        'An erasure request is already pending for this account. ' +
          'You will be contacted once it has been reviewed.',
      );
    }

    const req = await this.prisma.asAdmin(async (tx) => {
      const erasure = await tx.erasureRequest.create({
        data: {
          userId: params.userId,
          tenantId: params.tenantId,
          email: params.email,
          status: 'PENDING',
        },
      });
      await tx.user.update({
        where: { id: params.userId },
        data: { erasureRequestedAt: new Date() },
      });
      return erasure;
    });

    this.logger.log(
      `Erasure request submitted: userId=${params.userId} email=${params.email}`,
    );

    return {
      message:
        'Your right-to-erasure request has been submitted under NDPA 2023. ' +
        'You will be notified once it has been reviewed by our data team (typically within 30 days).',
      requestId: req.id,
    };
  }

  // ── Admin: list erasure requests ───────────────────────────────────────────
  async listErasureRequests(status?: string) {
    return this.prisma.asAdmin((tx) =>
      tx.erasureRequest.findMany({
        where: status ? { status: status as any } : undefined,
        orderBy: { requestedAt: 'desc' },
      }),
    );
  }

  // ── Admin: approve erasure — anonymises PII, does not touch invoices ───────
  async approveErasure(
    erasureRequestId: string,
    adminId: string,
    reviewNote?: string,
  ): Promise<{ message: string }> {
    const erasure = await this.prisma.asAdmin((tx) =>
      tx.erasureRequest.findUnique({ where: { id: erasureRequestId } }),
    );
    if (!erasure) throw new NotFoundException('Erasure request not found');
    if (erasure.status !== 'PENDING') {
      throw new ConflictException(`Erasure request is already ${erasure.status.toLowerCase()}`);
    }

    const randomHash = await bcrypt.hash(crypto.randomUUID(), 10);
    const anonEmail = `erased-${erasure.userId}@deleted.billinx.ng`;
    const now = new Date();

    await this.prisma.asAdmin(async (tx) => {
      // Anonymise the user record
      await tx.user.update({
        where: { id: erasure.userId },
        data: {
          firstName: 'Erased',
          lastName: 'User',
          email: anonEmail,
          passwordHash: randomHash,
          mfaEnabled: false,
          mfaSecret: null,
          mfaSecretIv: null,
          mfaBackupCodes: Prisma.JsonNull,
          isActive: false,
          isErased: true,
        },
      });

      // Revoke all active refresh tokens
      await tx.refreshToken.updateMany({
        where: { userId: erasure.userId, isRevoked: false },
        data: { isRevoked: true, revokedAt: now },
      });

      // Mark consent records as revoked
      await tx.consentRecord.updateMany({
        where: { userId: erasure.userId, isRevoked: false },
        data: { isRevoked: true, revokedAt: now },
      });

      // Mark erasure request complete
      await tx.erasureRequest.update({
        where: { id: erasureRequestId },
        data: {
          status: 'APPROVED',
          reviewedBy: adminId,
          reviewedAt: now,
          reviewNote: reviewNote ?? null,
          erasedAt: now,
        },
      });
    });

    this.logger.log(
      `Erasure approved: userId=${erasure.userId} by admin=${adminId}`,
    );

    return {
      message: `Account for ${erasure.email} has been anonymised under NDPA 2023.`,
    };
  }

  // ── Admin: reject erasure request ─────────────────────────────────────────
  async rejectErasure(
    erasureRequestId: string,
    adminId: string,
    reviewNote?: string,
  ): Promise<{ message: string }> {
    const erasure = await this.prisma.asAdmin((tx) =>
      tx.erasureRequest.findUnique({ where: { id: erasureRequestId } }),
    );
    if (!erasure) throw new NotFoundException('Erasure request not found');
    if (erasure.status !== 'PENDING') {
      throw new ConflictException(`Erasure request is already ${erasure.status.toLowerCase()}`);
    }

    await this.prisma.asAdmin(async (tx) => {
      await tx.erasureRequest.update({
        where: { id: erasureRequestId },
        data: {
          status: 'REJECTED',
          reviewedBy: adminId,
          reviewedAt: new Date(),
          reviewNote: reviewNote ?? null,
        },
      });
      // Clear the pending flag on the user so they can re-request later
      await tx.user.update({
        where: { id: erasure.userId },
        data: { erasureRequestedAt: null },
      });
    });

    this.logger.log(
      `Erasure rejected: userId=${erasure.userId} by admin=${adminId}`,
    );

    return {
      message: `Erasure request for ${erasure.email} has been rejected.`,
    };
  }
}
