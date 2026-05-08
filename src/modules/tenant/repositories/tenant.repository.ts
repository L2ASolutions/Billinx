import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../infrastructure/database/prisma.service";
import { CreateTenantRequest, UpdateTenantRequest } from "../../../../packages/types/tenant";

@Injectable()
export class TenantRepository {
  private readonly logger = new Logger(TenantRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.tenant.findUnique({
        where: { id },
      });
    });
  }

  async findByTin(tin: string) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.tenant.findUnique({
        where: { tin },
      });
    });
  }

  async findAll(skip = 0, take = 20) {
    return this.prisma.asAdmin(async (tx) => {
      const [data, total] = await Promise.all([
        tx.tenant.findMany({
          skip,
          take,
          orderBy: { createdAt: "desc" },
        }),
        tx.tenant.count(),
      ]);
      return { data, total };
    });
  }

  async create(
    data: CreateTenantRequest,
    encryptedCredential?: Buffer,
    credentialIv?: Buffer,
  ) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.tenant.create({
        data: {
          name: data.name,
          tin: data.tin,
          registeredAddress: data.registeredAddress as any,
          appAdapterKey: data.appAdapterKey,
          environment: data.environment ?? "SANDBOX",
          rateLimitTier: data.rateLimitTier ?? "STANDARD",
          batchEnabled: data.batchEnabled ?? false,
          batchSize: data.batchSize ?? 100,
          encryptedCredential: encryptedCredential ?? null,
          credentialIv: credentialIv ?? null,
        },
      });
    });
  }

  async update(
    id: string,
    data: UpdateTenantRequest,
    encryptedCredential?: Buffer,
    credentialIv?: Buffer,
  ) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.tenant.update({
        where: { id },
        data: {
          ...(data.name && { name: data.name }),
          ...(data.registeredAddress && {
            registeredAddress: data.registeredAddress as any,
          }),
          ...(data.appAdapterKey && { appAdapterKey: data.appAdapterKey }),
          ...(data.environment && { environment: data.environment }),
          ...(data.rateLimitTier && { rateLimitTier: data.rateLimitTier }),
          ...(data.batchEnabled !== undefined && {
            batchEnabled: data.batchEnabled,
          }),
          ...(data.batchSize !== undefined && { batchSize: data.batchSize }),
          ...(data.isActive !== undefined && { isActive: data.isActive }),
          ...(encryptedCredential && {
            encryptedCredential,
            credentialIv,
          }),
        },
      });
    });
  }

  async deactivate(id: string) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.tenant.update({
        where: { id },
        data: { isActive: false },
      });
    });
  }
}