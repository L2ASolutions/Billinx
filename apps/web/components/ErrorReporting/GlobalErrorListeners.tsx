"use client";

import { useEffect } from "react";
import { installGlobalErrorListeners } from "@/lib/errorReporting";

// Mounted once in the root layout. Covers runtime errors that never reach a
// React error boundary — a throw outside render (event handler, timer,
// non-React code) and an unawaited rejected promise. Renders nothing.
export function GlobalErrorListeners() {
  useEffect(() => {
    installGlobalErrorListeners();
  }, []);

  return null;
}
