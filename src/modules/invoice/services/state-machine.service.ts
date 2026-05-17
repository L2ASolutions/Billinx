import { Injectable } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';

interface Transition {
  from: InvoiceStatus | InvoiceStatus[];
  to: InvoiceStatus;
}

const TRANSITIONS: Transition[] = [
  { from: 'DRAFT', to: 'VALIDATING' },
  { from: 'VALIDATING', to: 'VALIDATION_FAILED' },
  { from: 'VALIDATING', to: 'QUEUED' },
  { from: 'QUEUED', to: 'SUBMITTING' },
  { from: 'SUBMITTING', to: 'SUBMITTED' },
  { from: 'SUBMITTED', to: 'ACCEPTED' },
  { from: 'SUBMITTED', to: 'REJECTED' },
  { from: 'SUBMITTING', to: 'SUBMISSION_FAILED' },
  { from: 'SUBMISSION_FAILED', to: 'QUEUED' },
  { from: 'SUBMISSION_FAILED', to: 'DEAD_LETTERED' },
  { from: 'ACCEPTED', to: 'CANCELLATION_REQUESTED' },
  { from: 'CANCELLATION_REQUESTED', to: 'CANCELLED' },
];

const TERMINAL_STATES: Set<InvoiceStatus> = new Set([
  'ACCEPTED',
  'REJECTED',
  'DEAD_LETTERED',
  'CANCELLED',
  'VALIDATION_FAILED',
]);

@Injectable()
export class StateMachineService {
  isValidTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
    if (TERMINAL_STATES.has(from)) return false;
    return TRANSITIONS.some(
      (t) =>
        (Array.isArray(t.from) ? t.from.includes(from) : t.from === from) &&
        t.to === to,
    );
  }

  assertValidTransition(from: InvoiceStatus, to: InvoiceStatus): void {
    if (!this.isValidTransition(from, to)) {
      throw new InvalidStateTransitionError(from, to);
    }
  }

  isTerminal(status: InvoiceStatus): boolean {
    return TERMINAL_STATES.has(status);
  }

  getAllowedTransitions(from: InvoiceStatus): InvoiceStatus[] {
    if (TERMINAL_STATES.has(from)) return [];
    return TRANSITIONS.filter((t) =>
      Array.isArray(t.from) ? t.from.includes(from) : t.from === from,
    ).map((t) => t.to);
  }
}

export class InvalidStateTransitionError extends Error {
  constructor(from: InvoiceStatus, to: InvoiceStatus) {
    super('Invalid state transition: ' + from + ' to ' + to);
    this.name = 'InvalidStateTransitionError';
  }
}
