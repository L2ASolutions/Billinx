/// <reference types="jest" />

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SupportTicketService } from './support-ticket.service';

let mockContext:
  | { tenantId?: string; actor?: string; actorType?: string }
  | undefined;

jest.mock('../../shared/context/request-context', () => ({
  getOptionalRequestContext: () => mockContext,
}));

jest.mock(
  'file-type',
  () => ({
    fileTypeFromBuffer: jest.fn(),
  }),
  { virtual: true },
);
import { fileTypeFromBuffer } from 'file-type';

describe('SupportTicketService', () => {
  let service: SupportTicketService;
  let prisma: any;
  let s3Service: any;
  let emailService: any;

  const screenshot = {
    buffer: Buffer.from('fake-png-bytes'),
  } as Express.Multer.File;

  beforeEach(() => {
    mockContext = undefined;
    (fileTypeFromBuffer as jest.Mock).mockResolvedValue({
      mime: 'image/png',
      ext: 'png',
    });

    const tx = {
      supportTicket: {
        create: jest.fn((args: any) => ({ ...args.data })),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn(),
        update: jest.fn((args: any) => ({ id: args.where.id, ...args.data })),
      },
      tenant: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    prisma = {
      supportTicket: tx.supportTicket,
      asAdmin: jest.fn((fn: any) => fn(tx)),
    };

    s3Service = {
      uploadPrivateObject: jest.fn().mockResolvedValue(undefined),
      getSignedViewUrl: jest
        .fn()
        .mockResolvedValue('https://signed-url.example'),
    };
    emailService = {
      sendSupportTicketNotification: jest.fn(),
    };

    service = new SupportTicketService(prisma, s3Service, emailService);
  });

  describe('createTicket', () => {
    const dto = {
      errorMessage: 'TypeError: boom',
      pageUrl: 'https://app.billinx.ng/invoices',
      browserInfo: 'Chrome 128 on macOS',
    };

    it('rejects a screenshot whose content is not a recognised image type', async () => {
      (fileTypeFromBuffer as jest.Mock).mockResolvedValue({
        mime: 'application/pdf',
        ext: 'pdf',
      });

      await expect(
        service.createTicket(dto as any, screenshot),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.supportTicket.create).not.toHaveBeenCalled();
    });

    it('scopes the write to the authenticated tenant/user from context, ignoring any client-supplied ids', async () => {
      mockContext = {
        tenantId: 'tenant-1',
        actor: 'user:user-1',
        actorType: 'user',
      };
      const dtoWithSpoofedIds = {
        ...dto,
        tenantId: 'someone-elses-tenant',
        userId: 'someone-else',
      };

      const result = await service.createTicket(dtoWithSpoofedIds, screenshot);

      expect(prisma.supportTicket.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 'tenant-1',
            userId: 'user-1',
            errorMessage: dto.errorMessage,
          }),
        }),
      );
      // Authenticated writes go through the RLS-scoped client directly, not asAdmin.
      expect(prisma.asAdmin).not.toHaveBeenCalled();
      expect(result.id).toBeTruthy();
    });

    it('falls back to asAdmin (bypassing RLS) when there is no tenant context, e.g. a pre-auth crash', async () => {
      mockContext = undefined;

      await service.createTicket(dto, screenshot);

      expect(prisma.asAdmin).toHaveBeenCalled();
    });

    it('uploads the screenshot to S3 under a per-tenant key and notifies the internal team', async () => {
      mockContext = {
        tenantId: 'tenant-1',
        actor: 'user:user-1',
        actorType: 'user',
      };

      await service.createTicket(dto, screenshot);

      expect(s3Service.uploadPrivateObject).toHaveBeenCalledWith(
        expect.stringContaining('support-tickets/tenant-1/'),
        screenshot.buffer,
        'image/png',
      );
      // Notification is fire-and-forget — flush microtasks before asserting.
      await Promise.resolve();
      await Promise.resolve();
      expect(emailService.sendSupportTicketNotification).toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    it('updates the status of an existing ticket', async () => {
      prisma.asAdmin = jest.fn((fn: any) =>
        fn({
          supportTicket: {
            findUnique: jest
              .fn()
              .mockResolvedValue({ id: 't1', status: 'OPEN' }),
            update: jest
              .fn()
              .mockResolvedValue({ id: 't1', status: 'RESOLVED' }),
          },
        }),
      );

      const result = await service.updateStatus('t1', 'RESOLVED');

      expect(result).toEqual({ id: 't1', status: 'RESOLVED' });
    });

    it('throws NotFoundException when the ticket does not exist', async () => {
      prisma.asAdmin = jest.fn((fn: any) =>
        fn({
          supportTicket: {
            findUnique: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
          },
        }),
      );

      await expect(service.updateStatus('missing', 'RESOLVED')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
