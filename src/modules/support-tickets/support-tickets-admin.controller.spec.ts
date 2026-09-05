/// <reference types="jest" />

import * as jwt from 'jsonwebtoken';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
// tsconfig has no esModuleInterop — CJS require form, matching the other
// supertest usage in this codebase (security-headers.spec.ts).
/* eslint-disable @typescript-eslint/no-require-imports */
import request = require('supertest');
/* eslint-enable @typescript-eslint/no-require-imports */
// support-ticket.service.ts imports 'file-type' at module scope, which this
// spec pulls in transitively via the controller import below — 'file-type'
// is ESM-only (no CJS export condition) so ts-jest can't resolve a real
// require() of it; a virtual mock sidesteps that the same way
// incoming-invoice.service.spec.ts does.
jest.mock(
  'file-type',
  () => ({
    fileTypeFromBuffer: jest.fn(),
  }),
  { virtual: true },
);

import { SupportTicketsAdminController } from './support-tickets-admin.controller';
import { SupportTicketService } from './support-ticket.service';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';

const ADMIN_SECRET = 'test-admin-secret';

describe('SupportTicketsAdminController (guard enforcement + delegation)', () => {
  let app: INestApplication;
  let supportTicketService: jest.Mocked<Partial<SupportTicketService>>;
  const ORIGINAL_ENV = process.env;

  beforeEach(async () => {
    process.env = { ...ORIGINAL_ENV, ADMIN_JWT_SECRET: ADMIN_SECRET };

    supportTicketService = {
      listTickets: jest
        .fn()
        .mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 }),
      getTicket: jest.fn().mockResolvedValue({ id: 't1' }),
      updateStatus: jest
        .fn()
        .mockResolvedValue({ id: 't1', status: 'RESOLVED' }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [SupportTicketsAdminController],
      providers: [
        { provide: SupportTicketService, useValue: supportTicketService },
        AdminJwtGuard,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    process.env = ORIGINAL_ENV;
    await app.close();
  });

  function adminToken(isAdmin: boolean) {
    return jwt.sign(
      { isAdmin, sub: 'admin-1', email: 'admin@billinx.ng', role: 'STAFF' },
      ADMIN_SECRET,
      { expiresIn: '1h' },
    );
  }

  it('rejects a request with no Authorization header', async () => {
    await request(app.getHttpServer())
      .get('/v1/admin/support-tickets')
      .expect(401);
    expect(supportTicketService.listTickets).not.toHaveBeenCalled();
  });

  it('rejects a non-admin token (valid JWT, but not marked isAdmin)', async () => {
    await request(app.getHttpServer())
      .get('/v1/admin/support-tickets')
      .set('Authorization', `Bearer ${adminToken(false)}`)
      .expect(401);
    expect(supportTicketService.listTickets).not.toHaveBeenCalled();
  });

  it('rejects a token signed with the wrong secret', async () => {
    const forged = jwt.sign({ isAdmin: true }, 'not-the-real-secret', {
      expiresIn: '1h',
    });
    await request(app.getHttpServer())
      .patch('/v1/admin/support-tickets/t1')
      .set('Authorization', `Bearer ${forged}`)
      .send({ status: 'RESOLVED' })
      .expect(401);
    expect(supportTicketService.updateStatus).not.toHaveBeenCalled();
  });

  it('allows a valid admin token through and delegates list filters to the service', async () => {
    await request(app.getHttpServer())
      .get('/v1/admin/support-tickets?status=OPEN&tenantId=tenant-1')
      .set('Authorization', `Bearer ${adminToken(true)}`)
      .expect(200);

    expect(supportTicketService.listTickets).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'OPEN', tenantId: 'tenant-1' }),
    );
  });

  it('allows a valid admin token to update a ticket status', async () => {
    await request(app.getHttpServer())
      .patch('/v1/admin/support-tickets/t1')
      .set('Authorization', `Bearer ${adminToken(true)}`)
      .send({ status: 'RESOLVED' })
      .expect(200);

    expect(supportTicketService.updateStatus).toHaveBeenCalledWith(
      't1',
      'RESOLVED',
    );
  });

  it('rejects an invalid status value from an admin caller (DTO validation)', async () => {
    await request(app.getHttpServer())
      .patch('/v1/admin/support-tickets/t1')
      .set('Authorization', `Bearer ${adminToken(true)}`)
      .send({ status: 'NOT_A_REAL_STATUS' })
      .expect(400);
  });
});
