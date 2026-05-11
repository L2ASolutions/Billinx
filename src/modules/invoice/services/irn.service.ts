import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../infrastructure/database/prisma.service";
import * as crypto from "crypto";

@Injectable()
export class IrnService {
  private readonly logger = new Logger(IrnService.name);

  constructor(private readonly prisma: PrismaService) {}

  async generateIrn(tenantTin: string): Promise<string> {
    const date = this.getDateString();
    const uid = crypto.randomUUID().split("-")[0];
    const counter = await this.getNextCounter(tenantTin, date);
    const paddedCounter = String(counter).padStart(4, "0");
    const irn = `${tenantTin}-${date}-${uid}-${paddedCounter}`;

    this.logger.log(`Generated IRN: ${irn}`);
    return irn;
  }

  async isIrnUnique(irn: string): Promise<boolean> {
    const existing = await this.prisma.asAdmin(async (tx) => {
      return tx.invoice.findUnique({
        where: { platformIrn: irn },
        select: { id: true },
      });
    });
    return !existing;
  }

  async generateUniqueIrn(tenantTin: string): Promise<string> {
    let irn = await this.generateIrn(tenantTin);
    let attempts = 0;

    while (!(await this.isIrnUnique(irn)) && attempts < 5) {
      irn = await this.generateIrn(tenantTin);
      attempts++;
    }

    if (attempts >= 5) {
      throw new Error("Failed to generate unique IRN after 5 attempts");
    }

    return irn;
  }

  private getDateString(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}${month}${day}`;
  }

  private async getNextCounter(
    tenantTin: string,
    date: string,
  ): Promise<number> {
    const prefix = `${tenantTin}-${date}`;

    const latest = await this.prisma.asAdmin(async (tx) => {
      return tx.invoice.findFirst({
        where: {
          platformIrn: { startsWith: prefix },
        },
        orderBy: { createdAt: "desc" },
        select: { platformIrn: true },
      });
    });

    if (!latest) return 1;

    const parts = latest.platformIrn.split("-");
    const lastCounter = parseInt(parts[parts.length - 1], 10);
    return isNaN(lastCounter) ? 1 : lastCounter + 1;
  }
}