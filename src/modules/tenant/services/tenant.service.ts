import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { TenantRepository } from '../repositories/tenant.repository';
import { CredentialService } from './credential.service';
import { SecretsService } from '../../../infrastructure/secrets/secrets.service';
import { ReminderService } from '../../reminder/services/reminder.service';
import {
  CreateTenantRequest,
  UpdateTenantRequest,
  TenantResponse,
  TenantListResponse,
} from '../../../../packages/types/tenant';

@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

  constructor(
    private readonly tenantRepository: TenantRepository,
    private readonly credentialService: CredentialService,
    private readonly secrets: SecretsService,
    private readonly reminderService: ReminderService,
  ) {}

  async createTenant(request: CreateTenantRequest): Promise<TenantResponse> {
    const existing = await this.tenantRepository.findByTin(request.tin);
    if (existing) {
      throw new ConflictException(
        `A tenant with TIN ${request.tin} already exists`,
      );
    }

    if (!this.isValidTin(request.tin)) {
      throw new BadRequestException(`Invalid TIN format: ${request.tin}`);
    }

    if (
      request.interswitchCredentials?.businessId &&
      !this.isValidUuid(request.interswitchCredentials.businessId)
    ) {
      throw new BadRequestException(
        `Invalid Interswitch business_id format: ${request.interswitchCredentials.businessId}`,
      );
    }

    let encryptedCredential: Buffer | undefined;
    let credentialIv: Buffer | undefined;

    if (request.appCredential) {
      const masterKey = await this.secrets.getMasterEncryptionKey();
      const { encrypted, iv } = this.credentialService.encryptCredential(
        request.appCredential as unknown as Record<string, unknown>,
        masterKey,
        request.tin,
      );
      encryptedCredential = encrypted;
      credentialIv = iv;
    }

    let interswitchClientSecret: Buffer | undefined;
    let interswitchSecretIv: Buffer | undefined;

    if (request.interswitchCredentials?.clientSecret) {
      const masterKey = await this.secrets.getMasterEncryptionKey();
      const { encrypted, iv } = this.credentialService.encrypt(
        request.interswitchCredentials.clientSecret,
        masterKey,
        request.tin,
      );
      interswitchClientSecret = encrypted;
      interswitchSecretIv = iv;
    }

    const tenant = await this.tenantRepository.create(
      request,
      encryptedCredential,
      credentialIv,
      interswitchClientSecret,
      interswitchSecretIv,
    );

    this.logger.log(
      `Tenant created: ${tenant.id} [${tenant.name}] TIN: ${tenant.tin}`,
    );

    this.reminderService
      .createDefaultRules(tenant.id)
      .catch((err) =>
        this.logger.warn(
          `Failed to create default reminder rules for tenant ${tenant.id}: ${err.message}`,
        ),
      );

    return this.mapToResponse(tenant);
  }

  async getTenant(id: string): Promise<TenantResponse> {
    const tenant = await this.tenantRepository.findById(id);
    if (!tenant) {
      throw new NotFoundException(`Tenant ${id} not found`);
    }
    return this.mapToResponse(tenant);
  }

  async getTenantByTin(tin: string): Promise<TenantResponse> {
    const tenant = await this.tenantRepository.findByTin(tin);
    if (!tenant) {
      throw new NotFoundException(`Tenant with TIN ${tin} not found`);
    }
    return this.mapToResponse(tenant);
  }

  async listTenants(page = 1, limit = 20): Promise<TenantListResponse> {
    const skip = (page - 1) * limit;
    const { data, total } = await this.tenantRepository.findAll(skip, limit);
    return {
      data: data.map((t) => this.mapToResponse(t)),
      total,
    };
  }

  async updateTenant(
    id: string,
    request: UpdateTenantRequest,
  ): Promise<TenantResponse> {
    const tenant = await this.tenantRepository.findById(id);
    if (!tenant) {
      throw new NotFoundException(`Tenant ${id} not found`);
    }

    if (
      request.interswitchCredentials?.businessId &&
      !this.isValidUuid(request.interswitchCredentials.businessId)
    ) {
      throw new BadRequestException(
        `Invalid Interswitch business_id format: ${request.interswitchCredentials.businessId}`,
      );
    }

    let encryptedCredential: Buffer | undefined;
    let credentialIv: Buffer | undefined;

    if (request.appCredential) {
      const masterKey = await this.secrets.getMasterEncryptionKey();
      const { encrypted, iv } = this.credentialService.encryptCredential(
        request.appCredential as unknown as Record<string, unknown>,
        masterKey,
        tenant.tin,
      );
      encryptedCredential = encrypted;
      credentialIv = iv;
    }

    let interswitchClientSecret: Buffer | undefined;
    let interswitchSecretIv: Buffer | undefined;

    if (request.interswitchCredentials?.clientSecret) {
      const masterKey = await this.secrets.getMasterEncryptionKey();
      const { encrypted, iv } = this.credentialService.encrypt(
        request.interswitchCredentials.clientSecret,
        masterKey,
        tenant.tin,
      );
      interswitchClientSecret = encrypted;
      interswitchSecretIv = iv;
    }

    const updated = await this.tenantRepository.update(
      id,
      request,
      encryptedCredential,
      credentialIv,
      interswitchClientSecret,
      interswitchSecretIv,
    );

    this.logger.log(`Tenant updated: ${id}`);
    return this.mapToResponse(updated);
  }

  async deactivateTenant(id: string): Promise<TenantResponse> {
    const tenant = await this.tenantRepository.findById(id);
    if (!tenant) {
      throw new NotFoundException(`Tenant ${id} not found`);
    }

    const updated = await this.tenantRepository.deactivate(id);
    this.logger.log(`Tenant deactivated: ${id}`);
    return this.mapToResponse(updated);
  }

  async getDecryptedCredential(
    tenantId: string,
  ): Promise<Record<string, unknown> | null> {
    const tenant = await this.tenantRepository.findById(tenantId);
    if (!tenant) {
      throw new NotFoundException(`Tenant ${tenantId} not found`);
    }

    if (!tenant.encryptedCredential || !tenant.credentialIv) {
      return null;
    }

    const masterKey = await this.secrets.getMasterEncryptionKey();
    return this.credentialService.decryptCredential(
      tenant.encryptedCredential,
      tenant.credentialIv,
      masterKey,
      tenant.tin,
    );
  }

  private isValidTin(tin: string): boolean {
    const tinPattern = /^[A-Z0-9-]{5,20}$/i;
    return tinPattern.test(tin);
  }

  // Matches InterswitchAdapter's BUSINESS_ID_UUID_RE — the NRS business_id
  // must be a UUID before the adapter will accept it at submission time, so
  // catch a malformed value here rather than at every future submission.
  private isValidUuid(value: string): boolean {
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidPattern.test(value);
  }

  private mapToResponse(tenant: any): TenantResponse {
    return {
      id: tenant.id,
      name: tenant.name,
      tin: tenant.tin,
      registeredAddress: tenant.registeredAddress,
      appAdapterKey: tenant.appAdapterKey,
      environment: tenant.environment,
      rateLimitTier: tenant.rateLimitTier,
      batchEnabled: tenant.batchEnabled,
      batchSize: tenant.batchSize,
      isActive: tenant.isActive,
      hasCredential: !!(tenant.encryptedCredential && tenant.credentialIv),
      hasInterswitchCredentials: !!(
        tenant.interswitchClientId && tenant.interswitchClientSecret
      ),
      interswitchServiceId: tenant.interswitchServiceId ?? null,
      interswitchBusinessId: tenant.interswitchBusinessId ?? null,
      createdAt: tenant.createdAt.toISOString(),
      updatedAt: tenant.updatedAt.toISOString(),
    };
  }
}
