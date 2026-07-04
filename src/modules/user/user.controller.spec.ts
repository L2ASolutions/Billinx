/// <reference types="jest" />

import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './services/user.service';
import { MfaService } from './services/mfa.service';

const TENANT_ID = 'tenant-001';
const USER_ID = 'user-001';

jest.mock('../../shared/context/request-context', () => ({
  getRequestContext: jest.fn().mockReturnValue({
    tenantId: 'tenant-001',
    actor: 'user:user-001',
    actorType: 'user',
  }),
}));

function makeReq(overrides: Record<string, any> = {}): any {
  return { ip: '203.0.113.5', headers: { 'user-agent': 'jest' }, ...overrides };
}

describe('UserController', () => {
  let controller: UserController;
  let userService: Record<string, jest.Mock>;
  let mfaService: Record<string, jest.Mock>;
  let prisma: { asAdmin: jest.Mock };
  let tx: Record<string, any>;

  beforeEach(() => {
    userService = {
      registerTenant: jest.fn().mockResolvedValue({ accessToken: 'token' }),
      findUserByEmail: jest.fn().mockResolvedValue({ tenantId: TENANT_ID }),
      login: jest.fn().mockResolvedValue({ accessToken: 'token' }),
      forgotPassword: jest.fn().mockResolvedValue({ message: 'sent' }),
      resetPassword: jest.fn().mockResolvedValue({ message: 'reset' }),
      acceptInvitation: jest.fn().mockResolvedValue({ accessToken: 'token' }),
      completeMfaChallenge: jest
        .fn()
        .mockResolvedValue({ accessToken: 'token' }),
      getUser: jest
        .fn()
        .mockResolvedValue({ id: USER_ID, email: 'user@example.com' }),
      updateUser: jest
        .fn()
        .mockResolvedValue({ id: USER_ID, firstName: 'Updated' }),
      changePassword: jest.fn().mockResolvedValue({ message: 'changed' }),
      getPreferences: jest
        .fn()
        .mockResolvedValue({ dashboardWidgets: {}, hidden: [] }),
      upsertPreferences: jest
        .fn()
        .mockResolvedValue({ dashboardWidgets: {}, hidden: [] }),
      listUsers: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      inviteUser: jest
        .fn()
        .mockResolvedValue({ message: 'invited', invitationToken: 'tok' }),
      assignRole: jest.fn().mockResolvedValue({ id: USER_ID }),
      removeRole: jest.fn().mockResolvedValue({ id: USER_ID }),
      deactivateUser: jest.fn().mockResolvedValue(undefined),
      requestAccess: jest
        .fn()
        .mockResolvedValue({ message: 'ok', referenceId: 'ref-1' }),
      listMyConsentRecords: jest.fn().mockResolvedValue([]),
      requestErasure: jest.fn().mockResolvedValue({ id: 'erasure-1' }),
    };
    mfaService = {
      setupMfa: jest
        .fn()
        .mockResolvedValue({ qrCodeBase64: 'x', manualKey: 'y' }),
      verifySetupAndEnable: jest.fn().mockResolvedValue(undefined),
      disableMfa: jest.fn().mockResolvedValue(undefined),
      generateBackupCodes: jest.fn().mockResolvedValue(['CODE1-ABCDE']),
      getMfaStatus: jest.fn().mockResolvedValue({
        mfaEnabled: true,
        hasBackupCodes: true,
        backupCodesRemaining: 5,
      }),
    };
    tx = {
      tenant: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: TENANT_ID,
          registeredAddress: { state: 'Lagos' },
          dashboardVisibility: {},
        }),
        update: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ id: TENANT_ID, ...data }),
          ),
      },
    };
    prisma = { asAdmin: jest.fn().mockImplementation((fn: any) => fn(tx)) };

    controller = new UserController(
      userService as unknown as UserService,
      mfaService as unknown as MfaService,
      prisma as any,
    );
  });

  // ── Public auth endpoints ─────────────────────────────────────────────────

  describe('register', () => {
    it('delegates the body to registerTenant', async () => {
      await controller.register({ tenantName: 'Acme' } as any);
      expect(userService.registerTenant).toHaveBeenCalledWith({
        tenantName: 'Acme',
      });
    });
  });

  describe('login', () => {
    it('uses the tenantId from the body directly when provided', async () => {
      await controller.login(
        { tenantId: TENANT_ID, email: 'a@b.com', password: 'x' },
        makeReq(),
      );
      expect(userService.findUserByEmail).not.toHaveBeenCalled();
      expect(userService.login).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({ email: 'a@b.com' }),
        '203.0.113.5',
        'jest',
      );
    });

    it('looks up tenantId by email when not supplied', async () => {
      await controller.login({ email: 'a@b.com', password: 'x' }, makeReq());
      expect(userService.findUserByEmail).toHaveBeenCalledWith('a@b.com');
      expect(userService.login).toHaveBeenCalledWith(
        TENANT_ID,
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    it('throws UnauthorizedException without calling login when the email is unknown', async () => {
      userService.findUserByEmail.mockResolvedValue(null);
      await expect(
        controller.login(
          { email: 'ghost@b.com', password: 'x' } as any,
          makeReq(),
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(userService.login).not.toHaveBeenCalled();
    });
  });

  describe('forgotPassword', () => {
    it('returns the generic message without calling the service when email is unknown', async () => {
      userService.findUserByEmail.mockResolvedValue(null);
      const result = await controller.forgotPassword({
        email: 'ghost@b.com',
      });
      expect(result.message).toMatch(/reset link has been sent/);
      expect(userService.forgotPassword).not.toHaveBeenCalled();
    });

    it('resolves tenantId by email and delegates when found', async () => {
      await controller.forgotPassword({ email: 'a@b.com' });
      expect(userService.forgotPassword).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({ email: 'a@b.com' }),
      );
    });

    it('uses the tenantId from the body directly when provided', async () => {
      await controller.forgotPassword({
        tenantId: TENANT_ID,
        email: 'a@b.com',
      });
      expect(userService.findUserByEmail).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword / acceptInvitation / mfaChallenge / resendMfa', () => {
    it('resetPassword delegates the body', async () => {
      await controller.resetPassword({ token: 't', newPassword: 'p' });
      expect(userService.resetPassword).toHaveBeenCalledWith({
        token: 't',
        newPassword: 'p',
      });
    });

    it('acceptInvitation delegates the body plus ip/user-agent', async () => {
      await controller.acceptInvitation({ token: 't' }, makeReq());
      expect(userService.acceptInvitation).toHaveBeenCalledWith(
        { token: 't' },
        '203.0.113.5',
        'jest',
      );
    });

    it('mfaChallenge delegates mfaToken/code plus ip/user-agent', async () => {
      await controller.mfaChallenge(
        { mfaToken: 'mt', code: '123456' },
        makeReq(),
      );
      expect(userService.completeMfaChallenge).toHaveBeenCalledWith(
        'mt',
        '123456',
        '203.0.113.5',
        'jest',
      );
    });

    it('resendMfa always throws BadRequestException', async () => {
      await expect(controller.resendMfa()).rejects.toThrow(BadRequestException);
    });
  });

  // ── MFA management ────────────────────────────────────────────────────────

  describe('MFA management routes', () => {
    it('setupMfa fetches the current user email then delegates to MfaService', async () => {
      await controller.setupMfa();
      expect(userService.getUser).toHaveBeenCalledWith(USER_ID);
      expect(mfaService.setupMfa).toHaveBeenCalledWith(
        USER_ID,
        'user@example.com',
      );
    });

    it('verifyMfaSetup delegates the code for the current user', async () => {
      const result = await controller.verifyMfaSetup({ code: '123456' });
      expect(mfaService.verifySetupAndEnable).toHaveBeenCalledWith(
        USER_ID,
        '123456',
      );
      expect(result.message).toMatch(/enabled/);
    });

    it('disableMfa delegates the code for the current user', async () => {
      const result = await controller.disableMfa({ code: '123456' });
      expect(mfaService.disableMfa).toHaveBeenCalledWith(USER_ID, '123456');
      expect(result.message).toMatch(/disabled/);
    });

    it('generateBackupCodes returns codes from MfaService', async () => {
      const result = await controller.generateBackupCodes();
      expect(mfaService.generateBackupCodes).toHaveBeenCalledWith(USER_ID);
      expect(result.codes).toEqual(['CODE1-ABCDE']);
    });

    it('getMfaStatus delegates to MfaService for the current user', async () => {
      const result = await controller.getMfaStatus();
      expect(mfaService.getMfaStatus).toHaveBeenCalledWith(USER_ID);
      expect(result.mfaEnabled).toBe(true);
    });
  });

  // ── Self-service profile ──────────────────────────────────────────────────

  describe('self-service profile routes', () => {
    it('getMe/updateMe/changePassword all scope to the current user id', async () => {
      await controller.getMe();
      expect(userService.getUser).toHaveBeenCalledWith(USER_ID);

      await controller.updateMe({ firstName: 'X' });
      expect(userService.updateUser).toHaveBeenCalledWith(USER_ID, {
        firstName: 'X',
      });

      await controller.changePassword({
        currentPassword: 'a',
        newPassword: 'b',
      });
      expect(userService.changePassword).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({ currentPassword: 'a' }),
      );
    });

    it('getPreferences/upsertPreferences scope to the current user and tenant', async () => {
      await controller.getPreferences();
      expect(userService.getPreferences).toHaveBeenCalledWith(USER_ID);

      await controller.upsertPreferences({ hidden: ['a'] });
      expect(userService.upsertPreferences).toHaveBeenCalledWith(
        USER_ID,
        TENANT_ID,
        { hidden: ['a'] },
      );
    });
  });

  // ── Tenant self-service ───────────────────────────────────────────────────

  describe('getMyTenant / updateMyTenant', () => {
    it('getMyTenant fetches the current tenant', async () => {
      const result = await controller.getMyTenant();
      expect(tx.tenant.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: TENANT_ID },
      });
      expect(result.id).toBe(TENANT_ID);
    });

    it('updateMyTenant only forwards allow-listed fields', async () => {
      await controller.updateMyTenant({
        name: 'New Name',
        notAllowedField: 'should be dropped',
      });
      const updateArgs = tx.tenant.update.mock.calls[0][0];
      expect(updateArgs.data).toEqual({ name: 'New Name' });
    });

    it('updateMyTenant merges address sub-fields into the existing registeredAddress JSON', async () => {
      await controller.updateMyTenant({ state: 'Abuja', city: 'Wuse' });
      const updateArgs = tx.tenant.update.mock.calls[0][0];
      expect(updateArgs.data.registeredAddress).toEqual({
        state: 'Abuja',
        city: 'Wuse',
      });
    });

    it('does not touch registeredAddress when no address field is present', async () => {
      await controller.updateMyTenant({ name: 'New Name' });
      const updateArgs = tx.tenant.update.mock.calls[0][0];
      expect(updateArgs.data.registeredAddress).toBeUndefined();
    });
  });

  // ── Dashboard visibility ──────────────────────────────────────────────────

  describe('getDashboardVisibility / updateDashboardVisibility', () => {
    it('returns built-in defaults merged with stored overrides for VIEWER/ACCOUNTANT', async () => {
      tx.tenant.findUniqueOrThrow.mockResolvedValue({
        dashboardVisibility: { VIEWER: { receivables: true } },
      });
      const result = await controller.getDashboardVisibility();
      expect(result.VIEWER.receivables).toBe(true);
      expect(result.VIEWER.pipeline_chart).toBe(true); // untouched default
      expect(result.ACCOUNTANT.receivables).toBe(true); // ACCOUNTANT default
    });

    it('rejects an invalid role', async () => {
      await expect(
        controller.updateDashboardVisibility({
          role: 'OWNER',
          section: 'receivables',
          visible: true,
        }),
      ).rejects.toThrow('role must be VIEWER or ACCOUNTANT');
    });

    it('rejects an invalid section', async () => {
      await expect(
        controller.updateDashboardVisibility({
          role: 'VIEWER',
          section: 'not_a_section',
          visible: true,
        }),
      ).rejects.toThrow(/section must be one of/);
    });

    it('rejects a non-boolean visible value', async () => {
      await expect(
        controller.updateDashboardVisibility({
          role: 'VIEWER',
          section: 'receivables',
          visible: 'yes',
        }),
      ).rejects.toThrow('visible must be a boolean');
    });

    it('persists the update and returns the effective merged visibility', async () => {
      tx.tenant.findUniqueOrThrow.mockResolvedValue({
        dashboardVisibility: {},
      });
      const result = await controller.updateDashboardVisibility({
        role: 'VIEWER',
        section: 'receivables',
        visible: true,
      });
      expect(tx.tenant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { dashboardVisibility: { VIEWER: { receivables: true } } },
        }),
      );
      expect(result.effective.receivables).toBe(true);
    });
  });

  // ── Team management ───────────────────────────────────────────────────────

  describe('team management routes', () => {
    it('listUsers scopes to the current tenant', async () => {
      await controller.listUsers();
      expect(userService.listUsers).toHaveBeenCalledWith(TENANT_ID);
    });

    it('inviteUser scopes tenantId and inviter to the current context', async () => {
      await controller.inviteUser({ email: 'new@b.com', role: 'VIEWER' });
      expect(userService.inviteUser).toHaveBeenCalledWith(
        TENANT_ID,
        USER_ID,
        expect.objectContaining({ email: 'new@b.com' }),
      );
    });

    it('assignRole scopes tenantId from context', async () => {
      await controller.assignRole('other-user', { role: 'ADMIN' });
      expect(userService.assignRole).toHaveBeenCalledWith(
        'other-user',
        TENANT_ID,
        'ADMIN',
      );
    });

    it('removeRole delegates the id and role params', async () => {
      await controller.removeRole('other-user', 'ADMIN');
      expect(userService.removeRole).toHaveBeenCalledWith(
        'other-user',
        'ADMIN',
      );
    });

    it('deactivateUser scopes tenantId from context', async () => {
      await controller.deactivateUser('other-user');
      expect(userService.deactivateUser).toHaveBeenCalledWith(
        'other-user',
        TENANT_ID,
      );
    });
  });

  // ── Public request-access ─────────────────────────────────────────────────

  describe('requestAccess', () => {
    it('delegates the body plus ip/user-agent', async () => {
      await controller.requestAccess({ companyName: 'Acme' }, makeReq());
      expect(userService.requestAccess).toHaveBeenCalledWith(
        { companyName: 'Acme' },
        '203.0.113.5',
        'jest',
      );
    });
  });

  // ── Consent / erasure ─────────────────────────────────────────────────────

  describe('getMyConsentRecords / requestErasure', () => {
    it('getMyConsentRecords scopes to the current user', async () => {
      await controller.getMyConsentRecords();
      expect(userService.listMyConsentRecords).toHaveBeenCalledWith(USER_ID);
    });

    it('requestErasure resolves the current user email then delegates', async () => {
      await controller.requestErasure();
      expect(userService.getUser).toHaveBeenCalledWith(USER_ID);
      expect(userService.requestErasure).toHaveBeenCalledWith(
        USER_ID,
        TENANT_ID,
        'user@example.com',
      );
    });
  });
});
