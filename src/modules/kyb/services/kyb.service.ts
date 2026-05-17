import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';

// ─── Fuzzy name matching ──────────────────────────────────────────────────────

const LEGAL_SUFFIXES =
  /\b(limited|ltd|plc|nigeria|ng|incorporated|inc|co|and|the|enterprise|enterprises|group|services|solutions)\b\.?/g;

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(LEGAL_SUFFIXES, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) =>
      i === 0 ? j : j === 0 ? i : 0,
    ),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function computeNameMatchScore(submitted: string, cac: string): number {
  const a = normalizeName(submitted);
  const b = normalizeName(cac);
  if (!a && !b) return 100;
  if (!a || !b) return 0;

  const maxLen = Math.max(a.length, b.length);
  const levScore = 1 - levenshtein(a, b) / maxLen;

  const wordsA = new Set(a.split(' ').filter(Boolean));
  const wordsB = new Set(b.split(' ').filter(Boolean));
  const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  const jaccard = union === 0 ? 1 : intersection / union;

  return Math.round((levScore * 0.6 + jaccard * 0.4) * 100);
}

function riskFromScore(score: number): {
  riskScore: 'GREEN' | 'AMBER' | 'RED';
  nameMatchResult: string;
} {
  if (score >= 90)
    return { riskScore: 'GREEN', nameMatchResult: 'HIGH_CONFIDENCE' };
  if (score >= 70)
    return { riskScore: 'AMBER', nameMatchResult: 'PARTIAL_MATCH' };
  return { riskScore: 'RED', nameMatchResult: 'LOW_CONFIDENCE' };
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class KybService {
  private readonly logger = new Logger(KybService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── TIN confirmation ───────────────────────────────────────────────────────
  async confirmTin(params: {
    accessRequestId: string;
    confirmed: boolean;
    proofNote?: string;
    ipAddress?: string;
  }): Promise<{ message: string; kybId: string }> {
    const request = await this.prisma.asAdmin((tx) =>
      tx.accessRequest.findUnique({ where: { id: params.accessRequestId } }),
    );
    if (!request) throw new NotFoundException('Access request not found');

    const now = new Date();

    const kyb = await this.prisma.asAdmin((tx) =>
      tx.kybVerification.upsert({
        where: { accessRequestId: params.accessRequestId },
        create: {
          accessRequestId: params.accessRequestId,
          tin: request.tin,
          tinUserConfirmed: params.confirmed,
          tinConfirmedAt: params.confirmed ? now : null,
          tinConfirmedIp: params.confirmed ? (params.ipAddress ?? null) : null,
          tinProofNote: params.proofNote ?? null,
        },
        update: {
          tinUserConfirmed: params.confirmed,
          tinConfirmedAt: params.confirmed ? now : null,
          tinConfirmedIp: params.confirmed ? (params.ipAddress ?? null) : null,
          tinProofNote: params.proofNote ?? null,
        },
      }),
    );

    this.logger.log(
      `TIN confirmation for ${params.accessRequestId}: confirmed=${params.confirmed}`,
    );

    return { message: 'TIN confirmation recorded.', kybId: kyb.id };
  }

  // ── CAC verification ───────────────────────────────────────────────────────
  async verifyCac(params: {
    accessRequestId: string;
    rcNumber: string;
  }): Promise<any> {
    const request = await this.prisma.asAdmin((tx) =>
      tx.accessRequest.findUnique({ where: { id: params.accessRequestId } }),
    );
    if (!request) throw new NotFoundException('Access request not found');

    // Ensure a KybVerification row exists before the network call
    await this.prisma.asAdmin((tx) =>
      tx.kybVerification.upsert({
        where: { accessRequestId: params.accessRequestId },
        create: {
          accessRequestId: params.accessRequestId,
          tin: request.tin,
          cacRcNumber: params.rcNumber,
        },
        update: { cacRcNumber: params.rcNumber },
      }),
    );

    await this.prisma.asAdmin((tx) =>
      tx.accessRequest.update({
        where: { id: params.accessRequestId },
        data: { cacRcNumber: params.rcNumber },
      }),
    );

    // ── CAC API call ────────────────────────────────────────────────────────
    const baseUrl = process.env.CAC_API_BASE_URL ?? '';
    const apiKey = process.env.CAC_API_KEY ?? '';
    let cacData: any = null;
    let cacError: string | null = null;

    try {
      if (!baseUrl) throw new Error('CAC_API_BASE_URL is not configured');

      const url = `${baseUrl}/search/rc?rc=${encodeURIComponent(params.rcNumber)}`;
      const resp = await fetch(url, {
        headers: {
          Accept: 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (!resp.ok) {
        cacError = `CAC API returned HTTP ${resp.status}`;
      } else {
        cacData = await resp.json();
      }
    } catch (err: any) {
      cacError = err.message ?? 'CAC API request failed';
      this.logger.warn(`CAC API error for RC ${params.rcNumber}: ${cacError}`);
    }

    // ── Process results ─────────────────────────────────────────────────────
    if (cacData) {
      const cacCompanyName: string =
        cacData.companyName ?? cacData.company_name ?? cacData.name ?? '';
      const cacStatus: string =
        cacData.status ?? cacData.companyStatus ?? cacData.company_status ?? '';
      const cacRegistrationDate: string =
        cacData.registrationDate ??
        cacData.registration_date ??
        cacData.rcDate ??
        '';
      const cacDirectors: any =
        cacData.directors ?? cacData.proprietors ?? cacData.partners ?? [];

      const nameScore = computeNameMatchScore(
        request.companyName,
        cacCompanyName,
      );
      const { riskScore, nameMatchResult } = riskFromScore(nameScore);
      const riskReasons: string[] = [];

      if (nameScore < 90) {
        riskReasons.push(
          `Name match ${nameScore}% — submitted: "${request.companyName}", CAC: "${cacCompanyName}"`,
        );
      }
      if (
        cacStatus &&
        !['ACTIVE', 'REGISTERED'].includes(cacStatus.toUpperCase())
      ) {
        riskReasons.push(`CAC company status: ${cacStatus}`);
      }

      await this.prisma.asAdmin(async (tx) => {
        await tx.kybVerification.update({
          where: { accessRequestId: params.accessRequestId },
          data: {
            cacVerified: true,
            cacVerifiedAt: new Date(),
            cacCompanyName,
            cacStatus,
            cacRegistrationDate,
            cacDirectors,
            cacRawResponse: cacData,
            cacErrorMessage: null,
            nameMatchScore: nameScore,
            nameMatchResult,
            riskScore,
            riskReasons,
          },
        });
        await tx.accessRequest.update({
          where: { id: params.accessRequestId },
          data: { kybScore: riskScore },
        });
      });

      this.logger.log(
        `CAC verified for ${params.accessRequestId}: company="${cacCompanyName}" ` +
          `score=${nameScore}% risk=${riskScore}`,
      );

      return {
        accessRequestId: params.accessRequestId,
        cacCompanyName,
        cacStatus,
        cacRegistrationDate,
        nameMatchScore: nameScore,
        nameMatchResult,
        riskScore,
        riskReasons,
      };
    }

    // ── CAC lookup failed → RED ─────────────────────────────────────────────
    const failReasons = [`CAC lookup failed: ${cacError}`];

    await this.prisma.asAdmin(async (tx) => {
      await tx.kybVerification.update({
        where: { accessRequestId: params.accessRequestId },
        data: {
          cacVerified: false,
          cacErrorMessage: cacError,
          riskScore: 'RED',
          riskReasons: failReasons,
        },
      });
      await tx.accessRequest.update({
        where: { id: params.accessRequestId },
        data: { kybScore: 'RED' },
      });
    });

    return {
      accessRequestId: params.accessRequestId,
      riskScore: 'RED',
      riskReasons: failReasons,
      error: cacError,
    };
  }
}
