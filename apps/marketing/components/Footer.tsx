import Image from "next/image";

const links = [
  { label: "Privacy Policy", href: "#" },
  { label: "Terms of Service", href: "#" },
  { label: "Contact", href: "#" },
];

function LinkedInIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.03-1.85-3.03-1.85 0-2.14 1.45-2.14 2.94v5.66H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z" />
    </svg>
  );
}

function XIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M13.6 10.62 20.2 3h-1.57l-5.73 6.62L8.32 3H3.4l6.92 10.07L3.4 21h1.57l6.06-6.99L15.68 21h4.92l-7-10.38Zm-2.15 2.48-.7-1L5.32 4.2h2.4l4.5 6.44.7 1 5.86 8.39h-2.4l-4.93-7.05Z" />
    </svg>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-white/10 bg-dark py-12">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-8 px-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col items-center gap-4 sm:items-start">
          <Image
            src="/billinx-wordmark-dark.svg"
            alt="Billinx"
            width={320}
            height={60}
            unoptimized
            className="h-8 w-auto"
          />
          <p className="text-sm text-white/50">
            © 2026 L2A Solutions. Built for Nigeria.
          </p>
        </div>

        <div className="flex flex-col items-center gap-6 sm:items-end">
          <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2 sm:justify-end">
            {links.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="text-sm text-white/60 transition-colors hover:text-white"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-4">
            <a
              href="#"
              aria-label="Billinx on LinkedIn"
              className="text-white/50 transition-colors hover:text-white"
            >
              <LinkedInIcon className="h-5 w-5" />
            </a>
            <a
              href="#"
              aria-label="Billinx on X"
              className="text-white/50 transition-colors hover:text-white"
            >
              <XIcon className="h-5 w-5" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
