import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "@/components/ui/Button";
import { getInvoiceStatusPill } from "@/lib/invoice-status";

describe("smoke", () => {
  it("renders a basic React component without crashing", () => {
    render(<div data-testid="smoke-div">hello</div>);
    expect(screen.getByTestId("smoke-div")).toHaveTextContent("hello");
  });

  it("returns the correct status label for ACCEPTED status", () => {
    const pill = getInvoiceStatusPill({ status: "ACCEPTED", paymentStatus: "PENDING" });
    expect(pill).toEqual({ label: "Accepted", variant: "green-outline" });
  });

  it("fires onClick when a button is clicked via userEvent", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click me</Button>);

    await user.click(screen.getByRole("button", { name: "Click me" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
