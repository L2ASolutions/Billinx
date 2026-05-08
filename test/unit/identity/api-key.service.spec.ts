/// <reference types="jest" />

import { Test, TestingModule } from "@nestjs/testing";
import { ApiKeyService } from "../../../src/modules/identity/services/api-key.service";
import { PrismaService } from "../../../src/infrastructure/database/prisma.service";
import { UnauthorizedException, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcrypt";

const mockApiKey = {
  create: jest.fn(),
  findMany: jest.fn(),
  findFirst: jest.fn(),
  update: jest.fn(),
};

const mockTenant = {
  findUnique: jest.fn(),
};

const mockPrisma = {
  asAdmin: jest.fn((fn: (p: any) => any) => fn({ apiKey: mockApiKey, tenant: mockTenant })),
  apiKey: mockApiKey,
  tenant: mockTenant,
};

describe("ApiKeyService", () => {
  let service: ApiKeyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ApiKeyService>(ApiKeyService);
    jest.clearAllMocks();
  });

  describe("createApiKey", () => {
    it("returns full key only on creation", async () => {
      mockApiKey.create.mockResolvedValue({
        id: "key-id",
        name: "Test Key",
        keyPrefix: "blx_live_abcd",
        environment: "PRODUCTION",
        expiresAt: null,
        createdAt: new Date(),
      });

      const result = await service.createApiKey("tenant-id", {
        name: "Test Key",
        environment: "PRODUCTION",
      });

      expect(result.key).toMatch(/^blx_live_/);
      expect(result.key.length).toBeGreaterThan(20);
    });
  });

  describe("verifyApiKey", () => {
    it("throws UnauthorizedException for unknown prefix", async () => {
      mockApiKey.findMany.mockResolvedValue([]);

      await expect(
        service.verifyApiKey("blx_live_unknownkey123456789"),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("throws UnauthorizedException for inactive tenant", async () => {
      const key = "blx_live_abcdtestkey1234567890123456789";
      const hash = await bcrypt.hash(key, 12);
      mockApiKey.findMany.mockResolvedValue([
        {
          id: "key-id",
          tenantId: "tenant-id",
          keyHash: hash,
          keyPrefix: key.substring(0, 20),
          environment: "PRODUCTION",
          tenant: {
            id: "tenant-id",
            isActive: false,
            rateLimitTier: "STANDARD",
          },
        },
      ]);

      await expect(service.verifyApiKey(key)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe("revokeApiKey", () => {
    it("throws NotFoundException when key does not belong to tenant", async () => {
      mockApiKey.findFirst.mockResolvedValue(null);

      await expect(
        service.revokeApiKey("tenant-id", "wrong-key-id"),
      ).rejects.toThrow(NotFoundException);
    });
  });
});