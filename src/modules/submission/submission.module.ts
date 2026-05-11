import { Module } from "@nestjs/common";
import { SubmissionService } from "./services/submission.service";
import { SubmissionWorker } from "./workers/submission.worker";
import { MockAdapter } from "./adapters/mock/mock.adapter";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { SecretsService } from "../../infrastructure/secrets/secrets.service";
import { ActivityService } from "../activity/services/activity.service";

@Module({
  providers: [
    SubmissionService,
    SubmissionWorker,
    MockAdapter,
    PrismaService,
    SecretsService,
    ActivityService,
  ],
  exports: [SubmissionService],
})
export class SubmissionModule {}