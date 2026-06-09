import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import {
  TrackEventRequest,
  ActivityEventType,
  ActivityListResponse,
  ActivityFilterParams,
  ErrorSeverity,
  SystemErrorListResponse,
  SystemErrorResponse,
  ErrorFilterParams,
  ErrorStatsResponse,
} from '../../../../packages/types/activity';

@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(private readonly prisma: PrismaService) {}

  track(event: TrackEventRequest): void {
    this.prisma
      .asAdmin(async (tx) => {
        const tenantId = event.tenantId ?? null;
        const occurredAt = new Date();

        const prior = await (tx as any).activityEvent.findFirst({
          where: tenantId ? { tenantId } : {},
          orderBy: { occurredAt: 'desc' },
          select: { entryHash: true },
        });

        const previousHash: string = prior?.entryHash ?? 'GENESIS';
        const payloadStr = JSON.stringify(event.payload);
        const hashInput = `${tenantId}|${event.eventType}|${event.actor}|${occurredAt.toISOString()}|${payloadStr}|${previousHash}`;
        const entryHash = crypto
          .createHash('sha256')
          .update(hashInput)
          .digest('hex');

        return (tx as any).activityEvent.create({
          data: {
            tenantId,
            eventType: event.eventType,
            actor: event.actor,
            actorEmail: event.actorEmail ?? null,
            ipAddress: event.ipAddress ?? null,
            userAgent: event.userAgent ?? null,
            entityType: event.entityType ?? null,
            entityId: event.entityId ?? null,
            payload: JSON.parse(payloadStr),
            occurredAt,
            entryHash,
            previousHash,
          },
        });
      })
      .catch((err) =>
        this.logger.error(`Activity tracking failed: ${err.message}`),
      );
  }

  trackError(params: {
    errorCode: string;
    errorMessage: string;
    stackTrace?: string;
    endpoint?: string;
    method?: string;
    severity?: ErrorSeverity;
    tenantId?: string;
    actor?: string;
    requestId?: string;
  }): void {
    this.prisma
      .asAdmin(async (tx) => {
        return tx.systemError.create({
          data: {
            tenantId: params.tenantId ?? null,
            errorCode: params.errorCode,
            errorMessage: params.errorMessage,
            stackTrace: params.stackTrace ?? null,
            endpoint: params.endpoint ?? null,
            method: params.method ?? null,
            severity: params.severity ?? 'LOW',
            actor: params.actor ?? null,
            requestId: params.requestId ?? null,
            isResolved: false,
          },
        });
      })
      .catch((err) =>
        this.logger.error(`Error tracking failed: ${err.message}`),
      );
  }

  async getActivity(
    filters: ActivityFilterParams,
  ): Promise<ActivityListResponse> {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 50, 100);
    const skip = (page - 1) * limit;
    const where: any = {};
    if (filters.tenantId) where.tenantId = filters.tenantId;
    if (filters.eventType) where.eventType = filters.eventType;
    if (filters.actor) where.actor = { contains: filters.actor };
    if (filters.entityId) where.entityId = filters.entityId;
    if (filters.from || filters.to) {
      where.occurredAt = {};
      if (filters.from) where.occurredAt.gte = new Date(filters.from);
      if (filters.to) where.occurredAt.lte = new Date(filters.to);
    }
    const [data, total] = await this.prisma.asAdmin(async (tx) => {
      return Promise.all([
        tx.activityEvent.findMany({
          where,
          skip,
          take: limit,
          orderBy: { occurredAt: 'desc' },
        }),
        tx.activityEvent.count({ where }),
      ]);
    });

    // Batch-resolve actor names for user: prefixed actors
    const userIds = [
      ...new Set(
        data
          .map((e: any) => e.actor as string)
          .filter((a: string) => a.startsWith('user:'))
          .map((a: string) => a.replace('user:', '')),
      ),
    ];
    const actorNameMap = new Map<string, string>();
    if (userIds.length > 0) {
      const users = await this.prisma.asAdmin((tx) =>
        tx.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true },
        }),
      );
      for (const u of users) {
        actorNameMap.set(u.id, `${u.firstName} ${u.lastName}`.trim());
      }
    }

    return {
      data: data.map((e: any) => {
        const actorId = (e.actor as string).startsWith('user:')
          ? (e.actor as string).replace('user:', '')
          : null;
        return {
          id: e.id,
          tenantId: e.tenantId ?? undefined,
          eventType: e.eventType as ActivityEventType,
          actor: e.actor,
          actorEmail: e.actorEmail ?? undefined,
          actorName: actorId ? actorNameMap.get(actorId) : undefined,
          entityType: e.entityType ?? undefined,
          entityId: e.entityId ?? undefined,
          payload: e.payload as Record<string, unknown>,
          occurredAt: e.occurredAt.toISOString(),
        };
      }),
      total,
      page,
      limit,
    };
  }

  async getErrors(
    filters: ErrorFilterParams,
  ): Promise<SystemErrorListResponse> {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 50, 100);
    const skip = (page - 1) * limit;
    const where: any = {};
    if (filters.tenantId) where.tenantId = filters.tenantId;
    if (filters.severity) where.severity = filters.severity;
    if (filters.isResolved !== undefined) where.isResolved = filters.isResolved;
    if (filters.from || filters.to) {
      where.occurredAt = {};
      if (filters.from) where.occurredAt.gte = new Date(filters.from);
      if (filters.to) where.occurredAt.lte = new Date(filters.to);
    }
    const [data, total] = await this.prisma.asAdmin(async (tx) => {
      return Promise.all([
        tx.systemError.findMany({
          where,
          skip,
          take: limit,
          orderBy: { occurredAt: 'desc' },
        }),
        tx.systemError.count({ where }),
      ]);
    });
    return {
      data: data.map((e: any) => this.mapError(e)),
      total,
      page,
      limit,
    };
  }

  async getErrorStats(): Promise<ErrorStatsResponse> {
    const [total, unresolved, critical, high, medium, low] =
      await this.prisma.asAdmin(async (tx) => {
        return Promise.all([
          tx.systemError.count(),
          tx.systemError.count({ where: { isResolved: false } }),
          tx.systemError.count({
            where: { severity: 'CRITICAL', isResolved: false },
          }),
          tx.systemError.count({
            where: { severity: 'HIGH', isResolved: false },
          }),
          tx.systemError.count({
            where: { severity: 'MEDIUM', isResolved: false },
          }),
          tx.systemError.count({
            where: { severity: 'LOW', isResolved: false },
          }),
        ]);
      });
    return { total, unresolved, critical, high, medium, low };
  }

  async resolveError(
    id: string,
    resolvedBy: string,
    resolutionNote?: string,
  ): Promise<SystemErrorResponse> {
    const updated = await this.prisma.asAdmin(async (tx) => {
      return tx.systemError.update({
        where: { id },
        data: {
          isResolved: true,
          resolvedAt: new Date(),
          resolvedBy,
          resolutionNote: resolutionNote ?? null,
        },
      });
    });
    return this.mapError(updated);
  }

  async getActivityForExport(filters: {
    tenantId?: string;
    eventType?: string;
    from?: string;
    to?: string;
  }): Promise<Array<{
    id: string;
    eventType: string;
    actor: string;
    actorEmail?: string;
    actorName?: string;
    entityType?: string;
    entityId?: string;
    ipAddress?: string;
    payload: Record<string, unknown>;
    occurredAt: string;
  }>> {
    const where: any = {};
    if (filters.tenantId) where.tenantId = filters.tenantId;
    if (filters.eventType) where.eventType = filters.eventType;
    if (filters.from || filters.to) {
      where.occurredAt = {};
      if (filters.from) where.occurredAt.gte = new Date(filters.from);
      if (filters.to) where.occurredAt.lte = new Date(filters.to);
    }

    const data = await this.prisma.asAdmin((tx) =>
      (tx as any).activityEvent.findMany({
        where,
        take: 5000,
        orderBy: { occurredAt: 'desc' },
      }),
    );

    const userIds = [
      ...new Set(
        (data as any[])
          .map((e: any) => e.actor as string)
          .filter((a: string) => a.startsWith('user:'))
          .map((a: string) => a.replace('user:', '')),
      ),
    ];
    const actorNameMap = new Map<string, string>();
    if (userIds.length > 0) {
      const users = await this.prisma.asAdmin((tx) =>
        (tx as any).user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        }),
      );
      for (const u of users as any[]) {
        const name = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
        actorNameMap.set(u.id, name || u.email);
      }
    }

    return (data as any[]).map((e: any) => {
      const actorId = (e.actor as string).startsWith('user:')
        ? (e.actor as string).replace('user:', '')
        : null;
      return {
        id: e.id,
        eventType: e.eventType,
        actor: e.actor,
        actorEmail: e.actorEmail ?? undefined,
        actorName: actorId ? actorNameMap.get(actorId) : undefined,
        entityType: e.entityType ?? undefined,
        entityId: e.entityId ?? undefined,
        ipAddress: e.ipAddress ?? undefined,
        payload: (e.payload as Record<string, unknown>) ?? {},
        occurredAt: e.occurredAt instanceof Date
          ? e.occurredAt.toISOString()
          : e.occurredAt,
      };
    });
  }

  async exportActivityCsv(filters: ActivityFilterParams): Promise<string> {
    const result = await this.getActivity({ ...filters, limit: 10000 });
    const headers = [
      'ID',
      'Tenant ID',
      'Event Type',
      'Actor',
      'Actor Email',
      'Entity Type',
      'Entity ID',
      'Occurred At',
    ].join(',');
    const rows = result.data.map((e) =>
      [
        e.id,
        e.tenantId ?? '',
        e.eventType,
        e.actor,
        e.actorEmail ?? '',
        e.entityType ?? '',
        e.entityId ?? '',
        e.occurredAt,
      ]
        .map((v) => `"${String(v).replace(/"/g, `""`)}"`)
        .join(','),
    );
    return [headers, ...rows].join('\n');
  }

  private mapError(e: any): SystemErrorResponse {
    return {
      id: e.id,
      tenantId: e.tenantId ?? undefined,
      errorCode: e.errorCode,
      errorMessage: e.errorMessage,
      stackTrace: e.stackTrace ?? undefined,
      endpoint: e.endpoint ?? undefined,
      method: e.method ?? undefined,
      actor: e.actor ?? undefined,
      requestId: e.requestId ?? undefined,
      severity: e.severity as ErrorSeverity,
      isResolved: e.isResolved,
      resolvedAt: e.resolvedAt?.toISOString(),
      resolvedBy: e.resolvedBy ?? undefined,
      resolutionNote: e.resolutionNote ?? undefined,
      occurredAt: e.occurredAt.toISOString(),
    };
  }
}
