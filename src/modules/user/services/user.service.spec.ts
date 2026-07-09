/// <reference types="jest" />

import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import {
  ConflictException,
  NotFoundException,
  HttpException,
} from '@nestjs/common';
import { UserService } from './user.service';

const TENANT_ID = 'tenant-001';
const USER_ID = 'user-001';

// Minimal RSA key pair for tests that exercise issueAccessToken.  Generated
// once at module load to avoid per-test overhead.
const { privateKey: TEST_PRIVATE_KEY_PEM } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
}) as { privateKey: string; publicKey: string };

function makeUserRecord(overrides: Record<string, any> = {}): any {
  return {
    id: USER_ID,
    tenantId: TENANT_ID,
    email: 'user@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    passwordHash: 'hash-placeholder',
    isActive: true,
    isVerified: true,
    mfaEnabled: false,
    roles: [{ role: 'VIEWER' }],
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeUserRepository(overrides: Record<string, any> = {}) {
  return {
    create: jest.fn().mockResolvedValue(makeUserRecord()),
    findById: jest.fn().mockResolvedValue(makeUserRecord()),
    findByEmail: jest.fn().mockResolvedValue(makeUserRecord()),
    findByEmailGlobal: jest.fn().mockResolvedValue(makeUserRecord()),
    findByTenantId: jest.fn().mockResolvedValue([makeUserRecord()]),
    update: jest
      .fn()
      .mockImplementation((_id: string, data: any) =>
        Promise.resolve({ ...makeUserRecord(), ...data }),
      ),
    addRole: jest.fn().mockResolvedValue(undefined),
    removeRole: jest.fn().mockResolvedValue(undefined),
    createInvitation: jest.fn().mockResolvedValue({ id: 'inv-1' }),
    findInvitationByToken: jest.fn().mockResolvedValue(null),
    acceptInvitation: jest.fn().mockResolvedValue(undefined),
    createPasswordResetToken: jest.fn().mockResolvedValue(undefined),
    findPasswordResetToken: jest.fn().mockResolvedValue(null),
    markPasswordResetTokenUsed: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makePrisma(overrides: Record<string, any> = {}) {
  const tx = {
    tenant: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({
        id: 'tenant-new',
        name: 'Acme Ltd',
        tin: '12345678-0001',
      }),
    },
    user: { findFirst: jest.fn().mockResolvedValue(null) },
    accessRequest: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({
        id: 'req-1',
        companyName: 'Acme',
        email: 'a@b.com',
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    userPreference: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
    ...overrides,
  };
  return {
    asAdmin: jest.fn().mockImplementation((fn: any) => fn(tx)),
    __tx: tx,
  };
}

describe('UserService', () => {
  let service: UserService;
  let userRepository: ReturnType<typeof makeUserRepository>;
  let prisma: ReturnType<typeof makePrisma>;
  let activityService: { track: jest.Mock };
  let redisService: {
    getLockoutStatus: jest.Mock;
    recordLoginFailure: jest.Mock;
    clearLoginFailures: jest.Mock;
  };
  let emailService: Record<string, jest.Mock>;
  let mfaService: {
    issueMfaToken: jest.Mock;
    verifyMfaToken: jest.Mock;
    verifyCode: jest.Mock;
  };
  let consentService: {
    record: jest.Mock;
    listByUser: jest.Mock;
    requestErasure: jest.Mock;
  };
  beforeEach(() => {
    userRepository = makeUserRepository();
    prisma = makePrisma();
    activityService = { track: jest.fn() };
    redisService = {
      getLockoutStatus: jest.fn().mockResolvedValue({
        locked: false,
        retryAfterSecs: 0,
        failedAttempts: 0,
      }),
      recordLoginFailure: jest
        .fn()
        .mockResolvedValue({ count: 1, locked: false, retryAfterSecs: 0 }),
      clearLoginFailures: jest.fn().mockResolvedValue(undefined),
    };
    emailService = {
      sendAccountLocked: jest.fn(),
      sendInvitation: jest.fn(),
      sendWelcome: jest.fn(),
      sendPasswordReset: jest.fn(),
      sendAccessRequestReceived: jest.fn(),
    };
    mfaService = {
      issueMfaToken: jest.fn().mockReturnValue('mfa-token'),
      verifyMfaToken: jest
        .fn()
        .mockReturnValue({ userId: USER_ID, tenantId: TENANT_ID }),
      verifyCode: jest.fn().mockResolvedValue(true),
    };
    consentService = {
      record: jest.fn().mockResolvedValue(undefined),
      listByUser: jest.fn().mockResolvedValue([]),
      requestErasure: jest.fn().mockResolvedValue({ id: 'erasure-1' }),
    };

    service = new UserService(
      userRepository as any,
      prisma as any,
      { getJwtPrivateKey: jest.fn().mockResolvedValue(TEST_PRIVATE_KEY_PEM) } as any,
      activityService as any,
      redisService as any,
      emailService as any,
      mfaService as any,
      consentService as any,
    );
  });

  // ── registerTenant ────────────────────────────────────────────────────────

  describe('registerTenant', () => {
    const request = {
      tenantName: 'Acme Ltd',
      tin: '12345678-0001',
      registeredAddress: {},
      email: 'owner@acme.test',
      password: 'S3cret!Password',
      firstName: 'Ada',
      lastName: 'Lovelace',
    } as any;

    it('throws ConflictException when the TIN is already registered', async () => {
      prisma.__tx.tenant.findUnique.mockResolvedValue({
        id: 'existing-tenant',
      });
      await expect(service.registerTenant(request)).rejects.toThrow(
        ConflictException,
      );
    });

    it('creates the tenant, an OWNER user, and issues an access token', async () => {
      const result = await service.registerTenant(request);

      expect(userRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-new', role: 'OWNER' }),
      );
      expect(result.accessToken).toEqual(expect.any(String));
      expect(result.tenant).toEqual(
        expect.objectContaining({ name: 'Acme Ltd', tin: '12345678-0001' }),
      );
      expect(activityService.track).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'TENANT_CREATED' }),
      );
      expect(activityService.track).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'USER_CREATED' }),
      );
    });

    it('stores a bcrypt hash of the password, not the raw password', async () => {
      await service.registerTenant(request);
      const createArgs = userRepository.create.mock.calls[0][0];
      expect(createArgs.passwordHash).not.toBe(request.password);
    });
  });

  // ── login ─────────────────────────────────────────────────────────────────

  describe('login', () => {
    const validPassword = 'S3cret!Password';
    let hashedUser: any;

    beforeEach(async () => {
      hashedUser = makeUserRecord({
        passwordHash: await bcrypt.hash(validPassword, 12),
      });
      userRepository.findByEmail.mockResolvedValue(hashedUser);
    });

    it('throws a 429 HttpException when the account is locked', async () => {
      redisService.getLockoutStatus.mockResolvedValue({
        locked: true,
        retryAfterSecs: 300,
        failedAttempts: 5,
      });
      await expect(
        service.login(TENANT_ID, {
          email: 'user@example.com',
          password: 'x',
        } as any),
      ).rejects.toThrow(HttpException);
      expect(userRepository.findByEmail).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException and records a failure for an unknown user, without leaking which case it was', async () => {
      userRepository.findByEmail.mockResolvedValue(null);
      await expect(
        service.login(TENANT_ID, {
          email: 'ghost@example.com',
          password: 'x',
        } as any),
      ).rejects.toThrow('Invalid email or password');
      expect(redisService.recordLoginFailure).toHaveBeenCalledWith(
        TENANT_ID,
        'ghost@example.com',
      );
    });

    it('throws UnauthorizedException for an inactive account', async () => {
      userRepository.findByEmail.mockResolvedValue(
        makeUserRecord({ isActive: false }),
      );
      await expect(
        service.login(TENANT_ID, {
          email: 'user@example.com',
          password: 'x',
        } as any),
      ).rejects.toThrow('Invalid email or password');
    });

    it('throws UnauthorizedException for a wrong password and records the failure', async () => {
      await expect(
        service.login(TENANT_ID, {
          email: 'user@example.com',
          password: 'wrong',
        } as any),
      ).rejects.toThrow('Invalid email or password');
      expect(redisService.recordLoginFailure).toHaveBeenCalledWith(
        TENANT_ID,
        'user@example.com',
      );
    });

    it('sends a lockout email and throws 429 once the failure threshold locks the account', async () => {
      redisService.recordLoginFailure.mockResolvedValue({
        count: 5,
        locked: true,
        retryAfterSecs: 900,
      });
      await expect(
        service.login(TENANT_ID, {
          email: 'user@example.com',
          password: 'wrong',
        } as any),
      ).rejects.toThrow(HttpException);
      expect(emailService.sendAccountLocked).toHaveBeenCalledWith(
        expect.objectContaining({ to: hashedUser.email }),
      );
    });

    it('returns mfaRequired and an MFA token when MFA is enabled, without issuing a full access token', async () => {
      userRepository.findByEmail.mockResolvedValue(
        makeUserRecord({
          passwordHash: hashedUser.passwordHash,
          mfaEnabled: true,
        }),
      );
      const result = await service.login(TENANT_ID, {
        email: 'user@example.com',
        password: validPassword,
      });

      expect(result).toEqual({
        mfaRequired: true,
        mfaToken: 'mfa-token',
        expiresIn: 300,
      });
      expect(userRepository.update).not.toHaveBeenCalled();
    });

    it('issues a full access token and clears failures on success without MFA', async () => {
      const result = await service.login(TENANT_ID, {
        email: 'user@example.com',
        password: validPassword,
      });

      expect(redisService.clearLoginFailures).toHaveBeenCalledWith(
        TENANT_ID,
        'user@example.com',
      );
      expect(result.accessToken).toEqual(expect.any(String));
      expect(result.tokenType).toBe('Bearer');
      expect(userRepository.update).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({ lastLoginAt: expect.any(Date) }),
      );
    });

    it('flags mfaSetupRequired for OWNER/ADMIN roles without MFA enabled', async () => {
      userRepository.findByEmail.mockResolvedValue(
        makeUserRecord({
          passwordHash: hashedUser.passwordHash,
          roles: [{ role: 'OWNER' }],
        }),
      );
      const result = await service.login(TENANT_ID, {
        email: 'user@example.com',
        password: validPassword,
      });
      expect(result.mfaSetupRequired).toBe(true);
    });

    it('does not flag mfaSetupRequired for a VIEWER', async () => {
      const result = await service.login(TENANT_ID, {
        email: 'user@example.com',
        password: validPassword,
      });
      expect(result.mfaSetupRequired).toBeUndefined();
    });
  });

  // ── completeMfaChallenge ──────────────────────────────────────────────────

  describe('completeMfaChallenge', () => {
    it('throws UnauthorizedException for an invalid MFA code', async () => {
      mfaService.verifyCode.mockResolvedValue(false);
      await expect(
        service.completeMfaChallenge('mfa-token', '000000'),
      ).rejects.toThrow('Invalid MFA code');
    });

    it('throws UnauthorizedException when the account is missing or inactive', async () => {
      userRepository.findById.mockResolvedValue(null);
      await expect(
        service.completeMfaChallenge('mfa-token', '123456'),
      ).rejects.toThrow('Account not found or inactive');
    });

    it('issues an access token and updates lastLoginAt on success', async () => {
      const result = await service.completeMfaChallenge('mfa-token', '123456');
      expect(result.accessToken).toEqual(expect.any(String));
      expect(userRepository.update).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({ lastLoginAt: expect.any(Date) }),
      );
    });
  });

  // ── inviteUser ────────────────────────────────────────────────────────────

  describe('inviteUser', () => {
    it('throws ConflictException when the user already exists in the tenant', async () => {
      await expect(
        service.inviteUser(TENANT_ID, 'user:admin-1', {
          email: 'user@example.com',
          role: 'VIEWER',
        } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('creates an invitation and returns the raw token', async () => {
      userRepository.findByEmail.mockResolvedValue(null);
      const result = await service.inviteUser(TENANT_ID, 'user:admin-1', {
        email: 'newperson@example.com',
        role: 'VIEWER',
      } as any);
      expect(result.invitationToken).toEqual(expect.any(String));
      expect(userRepository.createInvitation).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          email: 'newperson@example.com',
        }),
      );
      expect(activityService.track).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'USER_INVITED' }),
      );
    });
  });

  // ── acceptInvitation ──────────────────────────────────────────────────────

  describe('acceptInvitation', () => {
    it('throws BadRequestException for an unknown token', async () => {
      userRepository.findInvitationByToken.mockResolvedValue(null);
      await expect(
        service.acceptInvitation({ token: 'x', password: 'pw' } as any),
      ).rejects.toThrow('Invalid or expired invitation token');
    });

    it('throws BadRequestException for an already-accepted invitation', async () => {
      userRepository.findInvitationByToken.mockResolvedValue({
        tenantId: TENANT_ID,
        email: 'x@y.com',
        role: 'VIEWER',
        expiresAt: new Date(Date.now() + 86400000),
        acceptedAt: new Date(),
        isRevoked: false,
      });
      await expect(
        service.acceptInvitation({ token: 'x', password: 'pw' } as any),
      ).rejects.toThrow('already been used or revoked');
    });

    it('throws BadRequestException for an expired invitation', async () => {
      userRepository.findInvitationByToken.mockResolvedValue({
        tenantId: TENANT_ID,
        email: 'x@y.com',
        role: 'VIEWER',
        expiresAt: new Date(Date.now() - 1000),
        acceptedAt: null,
        isRevoked: false,
      });
      await expect(
        service.acceptInvitation({ token: 'x', password: 'pw' } as any),
      ).rejects.toThrow('has expired');
    });

    it('creates the user, marks the invitation accepted, and issues an access token', async () => {
      userRepository.findInvitationByToken.mockResolvedValue({
        tenantId: TENANT_ID,
        email: 'newperson@example.com',
        role: 'VIEWER',
        expiresAt: new Date(Date.now() + 86400000),
        acceptedAt: null,
        isRevoked: false,
      });

      const result = await service.acceptInvitation({
        token: 'valid-token',
        password: 'S3cret!Password',
        firstName: 'New',
        lastName: 'Person',
      });

      expect(userRepository.acceptInvitation).toHaveBeenCalledWith(
        'valid-token',
      );
      expect(result.accessToken).toEqual(expect.any(String));
    });
  });

  // ── forgotPassword / resetPassword ───────────────────────────────────────

  describe('forgotPassword', () => {
    it('returns a generic success message without sending an email for an unknown user (anti-enumeration)', async () => {
      userRepository.findByEmail.mockResolvedValue(null);
      const result = await service.forgotPassword(TENANT_ID, {
        email: 'ghost@x.com',
      });
      expect(result.message).toMatch(/If that email exists/);
      expect(emailService.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('creates a reset token and sends the reset email for a known user', async () => {
      await service.forgotPassword(TENANT_ID, {
        email: 'user@example.com',
      });
      expect(userRepository.createPasswordResetToken).toHaveBeenCalled();
      expect(emailService.sendPasswordReset).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'user@example.com' }),
      );
    });
  });

  describe('resetPassword', () => {
    it('throws BadRequestException for a missing token', async () => {
      userRepository.findPasswordResetToken.mockResolvedValue(null);
      await expect(
        service.resetPassword({ token: 'x', newPassword: 'y' } as any),
      ).rejects.toThrow('Invalid or expired reset token');
    });

    it('throws BadRequestException for an already-used token', async () => {
      userRepository.findPasswordResetToken.mockResolvedValue({
        userId: USER_ID,
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      });
      await expect(
        service.resetPassword({ token: 'x', newPassword: 'y' } as any),
      ).rejects.toThrow('Invalid or expired reset token');
    });

    it('throws BadRequestException for an expired token', async () => {
      userRepository.findPasswordResetToken.mockResolvedValue({
        userId: USER_ID,
        usedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      });
      await expect(
        service.resetPassword({ token: 'x', newPassword: 'y' } as any),
      ).rejects.toThrow('Invalid or expired reset token');
    });

    it('updates the password hash and marks the token used on success', async () => {
      userRepository.findPasswordResetToken.mockResolvedValue({
        userId: USER_ID,
        usedAt: null,
        expiresAt: new Date(Date.now() + 3600000),
      });
      await service.resetPassword({
        token: 'valid',
        newPassword: 'NewS3cret!',
      });
      expect(userRepository.update).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({ passwordHash: expect.any(String) }),
      );
      expect(userRepository.markPasswordResetTokenUsed).toHaveBeenCalledWith(
        'valid',
      );
    });
  });

  // ── changePassword ────────────────────────────────────────────────────────

  describe('changePassword', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      userRepository.findById.mockResolvedValue(null);
      await expect(
        service.changePassword(USER_ID, {
          currentPassword: 'a',
          newPassword: 'b',
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws UnauthorizedException when the current password is wrong', async () => {
      userRepository.findById.mockResolvedValue(
        makeUserRecord({ passwordHash: await bcrypt.hash('correct', 12) }),
      );
      await expect(
        service.changePassword(USER_ID, {
          currentPassword: 'wrong',
          newPassword: 'b',
        } as any),
      ).rejects.toThrow('Current password is incorrect');
    });

    it('updates the password hash on success', async () => {
      userRepository.findById.mockResolvedValue(
        makeUserRecord({ passwordHash: await bcrypt.hash('correct', 12) }),
      );
      await service.changePassword(USER_ID, {
        currentPassword: 'correct',
        newPassword: 'NewS3cret!',
      });
      expect(userRepository.update).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({ passwordHash: expect.any(String) }),
      );
    });
  });

  // ── user CRUD ─────────────────────────────────────────────────────────────

  describe('listUsers / getUser / updateUser', () => {
    it('listUsers maps repository records and reports the total', async () => {
      const result = await service.listUsers(TENANT_ID);
      expect(result.total).toBe(1);
      expect(result.data[0].id).toBe(USER_ID);
    });

    it('getUser throws NotFoundException when missing', async () => {
      userRepository.findById.mockResolvedValue(null);
      await expect(service.getUser('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('updateUser throws NotFoundException when missing', async () => {
      userRepository.findById.mockResolvedValue(null);
      await expect(
        service.updateUser('missing', { firstName: 'X' } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('updateUser applies the update and returns the mapped result', async () => {
      const result = await service.updateUser(USER_ID, {
        firstName: 'Updated',
      });
      expect(result.firstName).toBe('Updated');
    });
  });

  describe('assignRole / removeRole / deactivateUser', () => {
    it('assignRole throws NotFoundException when the user is missing', async () => {
      userRepository.findById.mockResolvedValue(null);
      await expect(
        service.assignRole('missing', TENANT_ID, 'ADMIN' as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('assignRole adds the role and returns the refreshed user', async () => {
      await service.assignRole(USER_ID, TENANT_ID, 'ADMIN');
      expect(userRepository.addRole).toHaveBeenCalledWith(
        USER_ID,
        TENANT_ID,
        'ADMIN',
      );
    });

    it('removeRole removes the role and returns the refreshed user', async () => {
      await service.removeRole(USER_ID, 'ADMIN');
      expect(userRepository.removeRole).toHaveBeenCalledWith(USER_ID, 'ADMIN');
    });

    it('deactivateUser throws NotFoundException for a cross-tenant user', async () => {
      userRepository.findById.mockResolvedValue(
        makeUserRecord({ tenantId: 'other-tenant' }),
      );
      await expect(service.deactivateUser(USER_ID, TENANT_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deactivateUser sets isActive false for the correct tenant', async () => {
      await service.deactivateUser(USER_ID, TENANT_ID);
      expect(userRepository.update).toHaveBeenCalledWith(USER_ID, {
        isActive: false,
      });
    });
  });

  // ── requestAccess / access request review ────────────────────────────────

  describe('requestAccess', () => {
    const request = {
      companyName: 'Acme',
      tin: '123',
      contactName: 'Ada',
      email: 'ada@acme.test',
    };

    it('returns the existing reference without creating a duplicate when one is already pending', async () => {
      prisma.__tx.accessRequest.findFirst.mockResolvedValue({
        id: 'existing-req',
      });
      const result = await service.requestAccess(request);
      expect(result.referenceId).toBe('existing-req');
      expect(prisma.__tx.accessRequest.create).not.toHaveBeenCalled();
    });

    it('creates a new access request and sends a confirmation email', async () => {
      const result = await service.requestAccess(request);
      expect(result.referenceId).toBe('req-1');
      expect(emailService.sendAccessRequestReceived).toHaveBeenCalled();
    });
  });

  describe('approveAccessRequest / rejectAccessRequest', () => {
    it('approveAccessRequest throws NotFoundException when missing', async () => {
      prisma.__tx.accessRequest.findUnique.mockResolvedValue(null);
      await expect(
        service.approveAccessRequest('missing', 'admin:1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('approveAccessRequest updates the status to APPROVED', async () => {
      prisma.__tx.accessRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        companyName: 'Acme',
        email: 'a@b.com',
      });
      await service.approveAccessRequest('req-1', 'admin:1', 'looks good');
      expect(prisma.__tx.accessRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'req-1' },
          data: expect.objectContaining({ status: 'APPROVED' }),
        }),
      );
    });

    it('rejectAccessRequest updates the status to REJECTED', async () => {
      prisma.__tx.accessRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        companyName: 'Acme',
        email: 'a@b.com',
      });
      await service.rejectAccessRequest('req-1', 'admin:1');
      expect(prisma.__tx.accessRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'REJECTED' }),
        }),
      );
    });
  });

  // ── preferences ───────────────────────────────────────────────────────────

  describe('getPreferences / upsertPreferences', () => {
    it('returns empty defaults when no preference row exists', async () => {
      const result = await service.getPreferences(USER_ID);
      expect(result).toEqual({ dashboardWidgets: {}, hidden: [] });
    });

    it('merges new preferences with existing stored ones', async () => {
      prisma.__tx.userPreference.findUnique.mockResolvedValue({
        preferences: { dashboardWidgets: { revenue: true }, hidden: ['a'] },
      });
      const result = await service.upsertPreferences(USER_ID, TENANT_ID, {
        hidden: ['b'],
      });
      expect(result.dashboardWidgets).toEqual({ revenue: true });
      expect(result.hidden).toEqual(['b']);
    });
  });
});
