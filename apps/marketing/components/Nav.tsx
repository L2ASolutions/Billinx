"use client";

import { useState } from "react";
import Image from "next/image";
import { Bars3Icon, XMarkIcon } from "@heroicons/react/24/outline";

const links = [
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Compliance", href: "#compliance" },
  { label: "Early Access", href: "#early-access" },
];

const APP_LOGIN_URL =
  process.env.NEXT_PUBLIC_APP_LOGIN_URL || "http://localhost:3001/login";

export function Nav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-dark/90 backdrop-blur">
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <a href="#top" className="flex items-center" onClick={() => setOpen(false)}>
          <Image
            src="/billinx-wordmark-dark.svg"
            alt="Billinx"
            width={320}
            height={60}
            unoptimized
            className="h-8 w-auto"
            priority
          />
        </a>

        <div className="hidden items-center gap-8 md:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-white/80 transition-colors hover:text-white"
            >
              {link.label}
            </a>
          ))}
          <a
            href={APP_LOGIN_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-white/30 px-4 py-2 text-sm font-semibold text-white transition-colors hover:border-white hover:bg-white/5"
          >
            Login / Sign Up
          </a>
          <a
            href="#early-access"
            className="rounded-lg bg-[#16a34a] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#15803d]"
          >
            Join the Waitlist
          </a>
        </div>

        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="text-white md:hidden"
        >
          {open ? <XMarkIcon className="h-7 w-7" /> : <Bars3Icon className="h-7 w-7" />}
        </button>
      </nav>

      {open && (
        <div className="border-t border-white/10 bg-dark px-6 pb-6 md:hidden">
          <div className="flex flex-col gap-1 pt-2">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-3 text-base font-medium text-white/80 transition-colors hover:bg-white/5 hover:text-white"
              >
                {link.label}
              </a>
            ))}
            <a
              href={APP_LOGIN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 rounded-lg border border-white/30 px-4 py-3 text-center text-base font-semibold text-white transition-colors hover:border-white hover:bg-white/5"
            >
              Login / Sign Up
            </a>
            <a
              href="#early-access"
              onClick={() => setOpen(false)}
              className="mt-2 rounded-lg bg-[#16a34a] px-4 py-3 text-center text-base font-semibold text-white transition-colors hover:bg-[#15803d]"
            >
              Join the Waitlist
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
