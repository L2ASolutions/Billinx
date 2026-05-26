import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { SecretsService } from '../../../infrastructure/secrets/secrets.service';
import {
  JwtPayload,
  TokenResponse,
  Environment,
  RateLimitTier,
} from '../../../../packages/types/identity';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

function parseDuration(value: string | undefined, defaultSecs: number): number {
  if (!value) return defaultSecs;
  const match = /^(\d+)(s|m|h|d)$/.exec(value);
  if (!match) return defaultSecs;
  const n = parseInt(match[1], 10);
  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
  };
  return n * (multipliers[match[2]] ?? 1);
}

const ACCESS_TOKEN_TTL = parseDuration(
  process.env.JWT_ACCESS_TOKEN_EXPIRY,
  15 * 60,
);
const REFRESH_TOKEN_TTL = parseDuration(
  process.env.JWT_REFRESH_TOKEN_EXPIRY,
  7 * 24 * 60 * 60,
);

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
  ) {}

  async issueTokenPair(
    userId: string,
    tenantId: string,
    environment: Environment,
    tier: RateLimitTier,
    role: 'admin' | 'member',
  ): Promise<{ tokenResponse: TokenResponse; refreshToken: string }> {
    // BUG-013: embed userId|tenantId prefix so rotateRefreshToken can scope
    // the DB query to this user instead of scanning all active tokens platform-wide.
    const refreshToken = this.generateRefreshToken(userId, tenantId);

    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: userId,
      tenantId,
      environment,
      tier,
      role,
    };

    // Use a simple secret for development
    const secret =
      process.env.JWT_SECRET ?? 'billinx-dev-secret-key-change-in-production';

    const accessToken = jwt.sign(payload, secret, {
      expiresIn: ACCESS_TOKEN_TTL,
    });

    const tokenHash = await bcrypt.hash(refreshToken, 10);
    await this.prisma.asAdmin(async (tx) => {
      return tx.refreshToken.create({
        data: {
          tenantId,
          userId,
          tokenHash,
          expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL * 1000),
        },
      });
    });

    return {
      tokenResponse: {
        accessToken,
        expiresIn: ACCESS_TOKEN_TTL,
        tokenType: 'Bearer',
      },
      refreshToken,
    };
  }

  async verifyAccessToken(token: string): Promise<JwtPayload> {
    const secret =
      process.env.JWT_SECRET ?? 'billinx-dev-secret-key-change-in-production';

    try {
      return jwt.verify(token, secret) as JwtPayload;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new UnauthorizedException('Access token expired');
      }
      throw new UnauthorizedException('Invalid access token');
    }
  }

  async rotateRefreshToken(
    rawRefreshToken: string,
  ): Promise<{ tokenResponse: TokenResponse; newRefreshToken: string }> {
    // BUG-013 fix: tokens now carry a "userId|tenantId|<random>" prefix so we
    // can scope the candidate query to a single user rather than fetching up to
    // 100 platform-wide tokens and bcrypt-comparing each one.
    const pipeIdx1 = rawRefreshToken.indexOf('|');
    const pipeIdx2 = pipeIdx1 !== -1 ? rawRefreshToken.indexOf('|', pipeIdx1 + 1) : -1;

    const hasPrefix = pipeIdx1 !== -1 && pipeIdx2 !== -1;
    const prefixUserId = hasPrefix ? rawRefreshToken.substring(0, pipeIdx1) : null;
    const prefixTenantId = hasPrefix
      ? rawRefreshToken.substring(pipeIdx1 + 1, pipeIdx2)
      : null;

    const candidateWhere: any = {
      isRevoked: false,
      expiresAt: { gt: new Date() },
    };
    if (prefixUserId && prefixTenantId) {
      // Narrow to this specific user — O(sessions per user) not O(platform)
      candidateWhere.userId = prefixUserId;
      candidateWhere.tenantId = prefixTenantId;
    }

    const candidates = await this.prisma.asAdmin(async (tx) => {
      return tx.refreshToken.findMany({
        where: candidateWhere,
        include: {
          tenant: {
            select: { environment: true, rateLimitTier: true },
          },
        },
        // Grace limit: keep a hard cap in case of old-format tokens without prefix
        take: hasPrefix ? 10 : 100,
      });
    });

    let matched: (typeof candidates)[0] | null = null;
    for (const candidate of candidates) {
      const valid = await bcrypt.compare(rawRefreshToken, candidate.tokenHash);
      if (valid) {
        matched = candidate;
        break;
      }
    }

    if (!matched) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    await this.prisma.asAdmin(async (tx) => {
      return tx.refreshToken.update({
        where: { id: matched.id },
        data: { isRevoked: true, revokedAt: new Date() },
      });
    });

    const result = await this.issueTokenPair(
      matched.userId,
      matched.tenantId,
      matched.tenant.environment,
      matched.tenant.rateLimitTier,
      'member',
    );

    return {
      tokenResponse: result.tokenResponse,
      newRefreshToken: result.refreshToken,
    };
  }

  async revokeAllUserTokens(userId: string, tenantId: string): Promise<void> {
    await this.prisma.asAdmin(async (tx) => {
      return tx.refreshToken.updateMany({
        where: { userId, tenantId, isRevoked: false },
        data: { isRevoked: true, revokedAt: new Date() },
      });
    });
  }

  // BUG-013: prefix with userId|tenantId| so rotateRefreshToken can scope the
  // DB query to this user instead of scanning all tokens platform-wide.
  private generateRefreshToken(userId: string, tenantId: string): string {
    const random = crypto.randomBytes(64).toString('base64url');
    return `${userId}|${tenantId}|${random}`;
  }
}
