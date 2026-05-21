import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.user.findUnique({ where: { id }, include: { roles: true } });
    });
  }

  async findByEmail(tenantId: string, email: string) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.user.findUnique({
        where: { tenantId_email: { tenantId, email } },
        include: { roles: true },
      });
    });
  }

  async findByEmailGlobal(email: string) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.user.findFirst({
        where: { email, isActive: true },
        include: { roles: true },
      });
    });
  }

  async findByTenantId(tenantId: string) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.user.findMany({
        where: { tenantId },
        include: { roles: true },
        orderBy: { createdAt: 'desc' },
      });
    });
  }

  async create(data: {
    tenantId: string;
    email: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
    isVerified?: boolean;
    role: string;
  }) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.user.create({
        data: {
          tenantId: data.tenantId,
          email: data.email,
          passwordHash: data.passwordHash,
          firstName: data.firstName,
          lastName: data.lastName,
          isVerified: data.isVerified ?? false,
          roles: {
            create: { tenantId: data.tenantId, role: data.role as any },
          },
        },
        include: { roles: true },
      });
    });
  }

  async update(
    id: string,
    data: {
      firstName?: string;
      lastName?: string;
      isActive?: boolean;
      isVerified?: boolean;
      passwordHash?: string;
      lastLoginAt?: Date;
    },
  ) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.user.update({ where: { id }, data, include: { roles: true } });
    });
  }

  async addRole(userId: string, tenantId: string, role: string) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.userRole.upsert({
        where: { userId_role: { userId, role: role as any } },
        create: { userId, tenantId, role: role as any },
        update: {},
      });
    });
  }

  async removeRole(userId: string, role: string) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.userRole.deleteMany({ where: { userId, role: role as any } });
    });
  }

  async createInvitation(data: {
    tenantId: string;
    email: string;
    role: string;
    token: string;
    invitedBy: string;
    expiresAt: Date;
  }) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.userInvitation.create({ data: data as any });
    });
  }

  async findInvitationByToken(token: string) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.userInvitation.findUnique({ where: { token } });
    });
  }

  async acceptInvitation(token: string) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.userInvitation.update({
        where: { token },
        data: { acceptedAt: new Date() },
      });
    });
  }

  async createPasswordResetToken(data: {
    userId: string;
    token: string;
    expiresAt: Date;
  }) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.passwordResetToken.create({ data });
    });
  }

  async findPasswordResetToken(token: string) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.passwordResetToken.findUnique({ where: { token } });
    });
  }

  async markPasswordResetTokenUsed(token: string) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.passwordResetToken.update({
        where: { token },
        data: { usedAt: new Date() },
      });
    });
  }
}
