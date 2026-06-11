-- Make ReminderLog.ruleId nullable to support manual (rule-free) reminders

ALTER TABLE "reminder_logs" ALTER COLUMN "rule_id" DROP NOT NULL;
