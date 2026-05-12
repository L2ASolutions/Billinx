/// <reference types="jest" />

import { StateMachineService } from "../../../src/modules/invoice/services/state-machine.service";

describe("StateMachineService", () => {
  let service: StateMachineService;

  beforeEach(() => {
    service = new StateMachineService();
  });

  describe("isValidTransition", () => {
    it("allows DRAFT to VALIDATING", () => {
      expect(service.isValidTransition("DRAFT", "VALIDATING")).toBe(true);
    });

    it("allows VALIDATING to QUEUED", () => {
      expect(service.isValidTransition("VALIDATING", "QUEUED")).toBe(true);
    });

    it("allows VALIDATING to VALIDATION_FAILED", () => {
      expect(service.isValidTransition("VALIDATING", "VALIDATION_FAILED")).toBe(true);
    });

    it("allows QUEUED to SUBMITTING", () => {
      expect(service.isValidTransition("QUEUED", "SUBMITTING")).toBe(true);
    });

    it("allows SUBMITTED to ACCEPTED", () => {
      expect(service.isValidTransition("SUBMITTED", "ACCEPTED")).toBe(true);
    });

    it("allows SUBMITTED to REJECTED", () => {
      expect(service.isValidTransition("SUBMITTED", "REJECTED")).toBe(true);
    });

    it("blocks ACCEPTED to QUEUED", () => {
      expect(service.isValidTransition("ACCEPTED", "QUEUED")).toBe(false);
    });

    it("blocks REJECTED to any state", () => {
      expect(service.isValidTransition("REJECTED", "QUEUED")).toBe(false);
      expect(service.isValidTransition("REJECTED", "DRAFT")).toBe(false);
      expect(service.isValidTransition("REJECTED", "ACCEPTED")).toBe(false);
    });

    it("blocks CANCELLED to any state", () => {
      expect(service.isValidTransition("CANCELLED", "DRAFT")).toBe(false);
      expect(service.isValidTransition("CANCELLED", "QUEUED")).toBe(false);
    });
  });

  describe("isTerminal", () => {
    it("marks ACCEPTED as terminal", () => {
      expect(service.isTerminal("ACCEPTED")).toBe(true);
    });

    it("marks REJECTED as terminal", () => {
      expect(service.isTerminal("REJECTED")).toBe(true);
    });

    it("marks CANCELLED as terminal", () => {
      expect(service.isTerminal("CANCELLED")).toBe(true);
    });

    it("marks DEAD_LETTERED as terminal", () => {
      expect(service.isTerminal("DEAD_LETTERED")).toBe(true);
    });

    it("marks QUEUED as not terminal", () => {
      expect(service.isTerminal("QUEUED")).toBe(false);
    });

    it("marks DRAFT as not terminal", () => {
      expect(service.isTerminal("DRAFT")).toBe(false);
    });
  });
});