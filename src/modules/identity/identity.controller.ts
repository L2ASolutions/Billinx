import {
  Controller,
  Post,
  Delete,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  Res,
  Req,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiHeader,
} from "@nestjs/swagger";
import { Response, Request } from "express";
import { ApiKeyService } from "./services/api-key.service";
import { TokenService } from "./services/token.service";
import { ApiKeyGuard } from "./guards/api-key.guard";
import { JwtGuard } from "./guards/jwt.guard";
import { AuthRateLimitGuard } from "../../shared/guards/auth-rate-limit.guard";
import { getRequestContext } from "../../shared/context/request-context";
import {
  CreateApiKeyRequest,
  TokenRequest,
  RevokeTokenRequest,
} from "../../../packages/types/identity";

const REFRESH_COOKIE_NAME = "billinx_refresh_token";
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

@ApiTags("Identity")
@Controller("v1")
export class IdentityController {
  constructor(
    private readonly apiKeyService: ApiKeyService,
    private readonly tokenService: TokenService,
  ) {}

  @Post("auth/token")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthRateLimitGuard)
  @ApiOperation({ summary: "Issue access token and refresh token" })
  async issueToken(
    @Body() body: TokenRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { tokenResponse, refreshToken } =
      await this.tokenService.issueTokenPair(
        body.email,
        body.tenantId,
        "PRODUCTION",
        "STANDARD",
        "member",
      );

    res.cookie(REFRESH_COOKIE_NAME, refreshToken, COOKIE_OPTIONS);

    return tokenResponse;
  }

  @Post("auth/refresh")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthRateLimitGuard)
  @ApiOperation({ summary: "Rotate refresh token and issue new access token" })
  async refreshToken(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawRefreshToken = (req as any).cookies?.[REFRESH_COOKIE_NAME];
    if (!rawRefreshToken) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        error: "MISSING_REFRESH_TOKEN",
        message: "No refresh token cookie present",
      });
    }

    const { tokenResponse, newRefreshToken } =
      await this.tokenService.rotateRefreshToken(rawRefreshToken);

    res.cookie(REFRESH_COOKIE_NAME, newRefreshToken, COOKIE_OPTIONS);

    return tokenResponse;
  }

  @Post("auth/revoke")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Revoke refresh tokens for current user" })
  async revokeToken(
    @Body() body: RevokeTokenRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ctx = getRequestContext();

    if (body.all) {
      const userId = ctx.actor.replace("user:", "");
      await this.tokenService.revokeAllUserTokens(userId, ctx.tenantId);
    }

    res.clearCookie(REFRESH_COOKIE_NAME);
  }

  @Post("api-keys")
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Create a new API key for the authenticated tenant" })
  @ApiHeader({ name: "Idempotency-Key", required: false })
  async createApiKey(@Body() body: CreateApiKeyRequest) {
    const ctx = getRequestContext();
    return this.apiKeyService.createApiKey(ctx.tenantId, body);
  }

  @Get("api-keys")
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List all active API keys for the authenticated tenant" })
  async listApiKeys() {
    const ctx = getRequestContext();
    return this.apiKeyService.listApiKeys(ctx.tenantId);
  }

  @Delete("api-keys/:keyId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Revoke an API key" })
  async revokeApiKey(@Param("keyId") keyId: string) {
    const ctx = getRequestContext();
    await this.apiKeyService.revokeApiKey(ctx.tenantId, keyId);
  }
}