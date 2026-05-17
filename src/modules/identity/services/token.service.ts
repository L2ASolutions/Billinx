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

const ACCESS_TOKEN_TTL = 15 * 60;
const REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60;

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
    const refreshToken = this.generateRefreshToken();

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
    const candidates = await this.prisma.asAdmin(async (tx) => {
      return tx.refreshToken.findMany({
        where: {
          isRevoked: false,
          expiresAt: { gt: new Date() },
        },
        include: {
          tenant: {
            select: { environment: true, rateLimitTier: true },
          },
        },
        take: 100,
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

  private generateRefreshToken(): string {
    return crypto.randomBytes(64).toString('base64url');
  }
}
