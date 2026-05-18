import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { SESClient, SendRawEmailCommand } from '@aws-sdk/client-ses';

const FROM_ADDRESS = process.env.EMAIL_FROM ?? 'Billinx <noreply@billinx.ng>';
const APP_BASE_URL = process.env.APP_BASE_URL ?? 'https://app.billinx.ng';
const AWS_REGION =
  process.env.AWS_SES_REGION ?? process.env.AWS_REGION ?? 'us-east-1';

// ─── Shared brand styles ──────────────────────────────────────────────────────

const BRAND_GREEN = '#1D9E75';
const BRAND_DARK = '#1a1a2e';

function baseLayout(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <!--[if mso]><style>td,th{border:none!important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Helvetica Neue,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f6f8;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"
             style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:${BRAND_DARK};padding:24px 32px;text-align:center;">
            <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">
              <span style="color:${BRAND_GREEN};">Billinx</span>
            </span>
            <div style="font-size:11px;color:#8899aa;margin-top:2px;letter-spacing:1px;text-transform:uppercase;">
              FIRS e-Invoicing Platform
            </div>
          </td>
        </tr>
        <!-- Body -->
        <tr><td style="padding:40px 32px;">${bodyHtml}</td></tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f4f6f8;padding:24px 32px;text-align:center;border-top:1px solid #e8ecf0;">
            <p style="margin:0 0 8px;font-size:12px;color:#8899aa;">
              &copy; ${new Date().getFullYear()} L2A Solutions Ltd &middot; Billinx e-Invoicing Platform
            </p>
            <p style="margin:0;font-size:11px;color:#aabbcc;line-height:1.6;">
              This email was sent in accordance with the Nigeria Data Protection Act 2023 (NDPA 2023).<br />
              You are receiving this because you have an account on Billinx.<br />
              If you did not expect this email, please ignore it or contact
              <a href="mailto:support@billinx.ng" style="color:${BRAND_GREEN};text-decoration:none;">support@billinx.ng</a>.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function h1(text: string): string {
  return `<h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:${BRAND_DARK};line-height:1.3;">${text}</h1>`;
}

function p(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;color:#444;line-height:1.7;">${text}</p>`;
}

function ctaButton(href: string, label: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0;">
    <tr>
      <td style="border-radius:6px;background:${BRAND_GREEN};">
        <a href="${href}" target="_blank"
           style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">
          ${label}
        </a>
      </td>
    </tr>
  </table>`;
}

function tokenBox(token: string): string {
  return `<div style="background:#f4f6f8;border:1px solid #dde3ec;border-radius:6px;padding:16px 20px;margin:16px 0;word-break:break-all;">
    <code style="font-size:13px;color:${BRAND_DARK};font-family:monospace;">${token}</code>
  </div>`;
}

function divider(): string {
  return `<hr style="border:none;border-top:1px solid #e8ecf0;margin:24px 0;" />`;
}

// ─── EmailService ─────────────────────────────────────────────────────────────

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly enabled: boolean;

  constructor() {
    const hasCredentials = !!(
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    );

    this.enabled = hasCredentials;

    if (hasCredentials) {
      const ses = new SESClient({
        region: AWS_REGION,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
      });

      this.transporter = nodemailer.createTransport({
        SES: { ses, aws: { SendRawEmailCommand } },
        sendingRate: 14,
      } as any);
    } else {
      // Ethereal / preview transport for local dev
      this.transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        auth: {
          user: process.env.DEV_SMTP_USER ?? '',
          pass: process.env.DEV_SMTP_PASS ?? '',
        },
      });
    }
  }

  // ─── Core send (fire-and-forget) ────────────────────────────────────────────

  private send(to: string, subject: string, html: string): void {
    if (!this.enabled && !process.env.DEV_SMTP_USER) {
      this.logger.debug(
        `[Email skipped — no transport] To: ${to} | Subject: ${subject}`,
      );
      return;
    }

    Promise.resolve().then(async () => {
      try {
        const info = await this.transporter.sendMail({
          from: FROM_ADDRESS,
          to,
          subject,
          html,
        });
        this.logger.log(
          `Email sent to ${to}: ${subject} (messageId: ${info.messageId})`,
        );
      } catch (err: any) {
        this.logger.error(`Failed to send email to ${to}: ${err.message}`);
      }
    });
  }

  // ─── 1. User invited ─────────────────────────────────────────────────────────

  sendInvitation(opts: {
    to: string;
    invitedByName: string;
    tenantName: string;
    role: string;
    token: string;
  }): void {
    const link = `${APP_BASE_URL}/accept-invitation?token=${opts.token}`;
    const html = baseLayout(
      'You have been invited to Billinx',
      h1('You have been invited') +
        p(
          `<strong>${opts.invitedByName}</strong> has invited you to join <strong>${opts.tenantName}</strong> on Billinx as <strong>${opts.role}</strong>.`,
        ) +
        p(
          'Click the button below to accept your invitation and set your password.',
        ) +
        ctaButton(link, 'Accept Invitation') +
        p(
          `This invitation expires in 7 days. If the button above does not work, copy and paste the link below into your browser:`,
        ) +
        tokenBox(link) +
        divider() +
        p(
          `If you were not expecting this invitation, you can safely ignore this email.`,
        ),
    );

    this.send(
      opts.to,
      `You've been invited to ${opts.tenantName} on Billinx`,
      html,
    );
  }

  // ─── 2. Invitation accepted → welcome email ──────────────────────────────────

  sendWelcome(opts: {
    to: string;
    firstName: string;
    tenantName: string;
    role: string;
  }): void {
    const loginLink = `${APP_BASE_URL}/login`;
    const html = baseLayout(
      'Welcome to Billinx',
      h1(`Welcome to Billinx, ${opts.firstName}!`) +
        p(
          `Your account has been created and you are now a member of <strong>${opts.tenantName}</strong> with the role of <strong>${opts.role}</strong>.`,
        ) +
        p(
          'You can now log in and start managing your e-invoices for FIRS compliance.',
        ) +
        ctaButton(loginLink, 'Go to Dashboard') +
        divider() +
        p(
          `Need help? Our documentation is at <a href="https://docs.billinx.ng" style="color:${BRAND_GREEN};">docs.billinx.ng</a> or email us at <a href="mailto:support@billinx.ng" style="color:${BRAND_GREEN};">support@billinx.ng</a>.`,
        ),
    );

    this.send(opts.to, 'Welcome to Billinx — your account is ready', html);
  }

  // ─── 3. Password reset ────────────────────────────────────────────────────────

  sendPasswordReset(opts: {
    to: string;
    firstName: string;
    token: string;
  }): void {
    const link = `${APP_BASE_URL}/reset-password?token=${opts.token}`;
    const html = baseLayout(
      'Reset your Billinx password',
      h1('Reset your password') +
        p(
          `Hi ${opts.firstName}, we received a request to reset the password for your Billinx account.`,
        ) +
        p(
          'Click the button below to choose a new password. This link expires in 2 hours.',
        ) +
        ctaButton(link, 'Reset Password') +
        p(
          'If the button does not work, copy and paste this link into your browser:',
        ) +
        tokenBox(link) +
        divider() +
        p(
          'If you did not request a password reset, you can safely ignore this email. Your password will not change.',
        ),
    );

    this.send(opts.to, 'Reset your Billinx password', html);
  }

  // ─── 4. Access request received ──────────────────────────────────────────────

  sendAccessRequestReceived(opts: {
    to: string;
    contactName: string;
    companyName: string;
    referenceId: string;
  }): void {
    const html = baseLayout(
      'We received your Billinx access request',
      h1('We received your request') +
        p(`Hi ${opts.contactName},`) +
        p(
          `Thank you for applying for access to Billinx on behalf of <strong>${opts.companyName}</strong>. We have received your request and our team will review it within 24 hours.`,
        ) +
        p(
          'You will receive an email notification once your request has been reviewed.',
        ) +
        divider() +
        `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
        <tr>
          <td style="background:#f4f6f8;border-radius:6px;padding:16px 20px;">
            <p style="margin:0 0 6px;font-size:12px;color:#8899aa;text-transform:uppercase;letter-spacing:1px;">Reference ID</p>
            <code style="font-size:14px;color:${BRAND_DARK};font-weight:600;">${opts.referenceId}</code>
          </td>
        </tr>
      </table>` +
        p('') +
        p(
          'Keep this reference ID for your records. If you have any questions, contact us at <a href="mailto:support@billinx.ng" style="color:' +
            BRAND_GREEN +
            ';">support@billinx.ng</a>.',
        ),
    );

    this.send(opts.to, 'Billinx — we received your access request', html);
  }

  // ─── 5. Access request approved ──────────────────────────────────────────────

  sendAccessRequestApproved(opts: {
    to: string;
    contactName: string;
    companyName: string;
    invitationToken?: string;
  }): void {
    const html = baseLayout(
      'Your Billinx access request has been approved',
      h1('Your request has been approved!') +
        p(`Hi ${opts.contactName},`) +
        p(
          `Great news — your access request for <strong>${opts.companyName}</strong> has been approved. Your Billinx account is ready.`,
        ) +
        (opts.invitationToken
          ? p(
              'Click the button below to set your password and activate your account.',
            ) +
            ctaButton(
              `${APP_BASE_URL}/accept-invitation?token=${opts.invitationToken}`,
              'Activate Your Account',
            ) +
            p('This link expires in 7 days.')
          : p(
              'An invitation will be sent to this address shortly by our team.',
            )) +
        divider() +
        p(
          'If you have any questions about getting started, visit <a href="https://docs.billinx.ng" style="color:' +
            BRAND_GREEN +
            ';">docs.billinx.ng</a> or contact <a href="mailto:support@billinx.ng" style="color:' +
            BRAND_GREEN +
            ';">support@billinx.ng</a>.',
        ),
    );

    this.send(opts.to, 'Your Billinx access request has been approved', html);
  }

  // ─── 6. Invoice accepted ──────────────────────────────────────────────────────

  sendInvoiceAccepted(opts: {
    to: string;
    tenantName: string;
    invoiceId: string;
    platformIrn: string;
    firsConfirmedIrn?: string;
    buyerName?: string;
    totalAmount?: string;
  }): void {
    const dashboardLink = `${APP_BASE_URL}/invoices/${opts.invoiceId}`;
    const html = baseLayout(
      'Invoice accepted by FIRS',
      `<div style="display:inline-block;background:#e6f9f3;border:1px solid #1D9E75;border-radius:20px;padding:4px 14px;margin-bottom:20px;">
        <span style="font-size:12px;font-weight:600;color:${BRAND_GREEN};text-transform:uppercase;letter-spacing:0.5px;">&#10003; FIRS Accepted</span>
      </div>` +
        h1('Invoice accepted') +
        p(
          `Good news — FIRS has accepted an invoice submitted by <strong>${opts.tenantName}</strong>.`,
        ) +
        `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"
              style="background:#f8faf9;border:1px solid #d4edda;border-radius:6px;margin:0 0 20px;">
        <tr><td style="padding:20px;">
          ${opts.buyerName ? `<div style="margin-bottom:12px;"><span style="font-size:12px;color:#8899aa;text-transform:uppercase;letter-spacing:1px;">Buyer</span><br /><strong style="color:${BRAND_DARK};">${opts.buyerName}</strong></div>` : ''}
          <div style="margin-bottom:12px;"><span style="font-size:12px;color:#8899aa;text-transform:uppercase;letter-spacing:1px;">Platform IRN</span><br /><code style="font-size:13px;color:${BRAND_DARK};">${opts.platformIrn}</code></div>
          ${opts.firsConfirmedIrn ? `<div style="margin-bottom:12px;"><span style="font-size:12px;color:#8899aa;text-transform:uppercase;letter-spacing:1px;">FIRS Confirmed IRN</span><br /><code style="font-size:13px;color:${BRAND_DARK};">${opts.firsConfirmedIrn}</code></div>` : ''}
          ${opts.totalAmount ? `<div><span style="font-size:12px;color:#8899aa;text-transform:uppercase;letter-spacing:1px;">Amount</span><br /><strong style="font-size:16px;color:${BRAND_GREEN};">${opts.totalAmount}</strong></div>` : ''}
        </td></tr>
      </table>` +
        ctaButton(dashboardLink, 'View Invoice') +
        divider() +
        p(
          'You can download the invoice QR code and compliance certificate from your Billinx dashboard.',
        ),
    );

    this.send(opts.to, `Invoice accepted by FIRS — ${opts.platformIrn}`, html);
  }

  // ─── 7. Invoice rejected ──────────────────────────────────────────────────────

  sendInvoiceRejected(opts: {
    to: string;
    tenantName: string;
    invoiceId: string;
    platformIrn: string;
    errorCode?: string;
    errorMessage?: string;
    buyerName?: string;
  }): void {
    const dashboardLink = `${APP_BASE_URL}/invoices/${opts.invoiceId}`;
    const html = baseLayout(
      'Invoice rejected by FIRS',
      `<div style="display:inline-block;background:#fdf0ef;border:1px solid #e74c3c;border-radius:20px;padding:4px 14px;margin-bottom:20px;">
        <span style="font-size:12px;font-weight:600;color:#c0392b;text-transform:uppercase;letter-spacing:0.5px;">&#10007; FIRS Rejected</span>
      </div>` +
        h1('Invoice rejected') +
        p(
          `Unfortunately, FIRS has rejected an invoice submitted by <strong>${opts.tenantName}</strong>. You may need to correct and resubmit it.`,
        ) +
        `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"
              style="background:#fdf8f8;border:1px solid #f5c6cb;border-radius:6px;margin:0 0 20px;">
        <tr><td style="padding:20px;">
          ${opts.buyerName ? `<div style="margin-bottom:12px;"><span style="font-size:12px;color:#8899aa;text-transform:uppercase;letter-spacing:1px;">Buyer</span><br /><strong style="color:${BRAND_DARK};">${opts.buyerName}</strong></div>` : ''}
          <div style="margin-bottom:12px;"><span style="font-size:12px;color:#8899aa;text-transform:uppercase;letter-spacing:1px;">Platform IRN</span><br /><code style="font-size:13px;color:${BRAND_DARK};">${opts.platformIrn}</code></div>
          ${opts.errorCode ? `<div style="margin-bottom:12px;"><span style="font-size:12px;color:#8899aa;text-transform:uppercase;letter-spacing:1px;">Error Code</span><br /><code style="font-size:13px;color:#c0392b;">${opts.errorCode}</code></div>` : ''}
          ${opts.errorMessage ? `<div><span style="font-size:12px;color:#8899aa;text-transform:uppercase;letter-spacing:1px;">Reason</span><br /><span style="font-size:14px;color:#444;">${opts.errorMessage}</span></div>` : ''}
        </td></tr>
      </table>` +
        ctaButton(dashboardLink, 'View & Correct Invoice') +
        divider() +
        p(
          'Review the rejection reason, correct the invoice data, and resubmit through your Billinx dashboard. Contact <a href="mailto:support@billinx.ng" style="color:' +
            BRAND_GREEN +
            ';">support@billinx.ng</a> if you need assistance.',
        ),
    );

    this.send(opts.to, `Invoice rejected by FIRS — ${opts.platformIrn}`, html);
  }

  // ─── 8. API key expiry warning ───────────────────────────────────────────────

  sendApiKeyExpiryWarning(opts: {
    to: string;
    firstName: string;
    tenantName: string;
    keyName: string;
    keyPrefix: string;
    daysLeft: number;
    isUrgent: boolean;
    expiresAt: string;
  }): void {
    const dashboardLink = `${APP_BASE_URL}/api-keys`;
    const urgentBadge = opts.isUrgent
      ? `<div style="display:inline-block;background:#fdf0ef;border:1px solid #e74c3c;border-radius:20px;padding:4px 14px;margin-bottom:20px;">
          <span style="font-size:12px;font-weight:600;color:#c0392b;text-transform:uppercase;letter-spacing:0.5px;">&#9888; Expires in ${opts.daysLeft} day${opts.daysLeft !== 1 ? 's' : ''}</span>
        </div>`
      : `<div style="display:inline-block;background:#fff3cd;border:1px solid #ffc107;border-radius:20px;padding:4px 14px;margin-bottom:20px;">
          <span style="font-size:12px;font-weight:600;color:#856404;text-transform:uppercase;letter-spacing:0.5px;">&#8987; Expires in ${opts.daysLeft} days</span>
        </div>`;

    const subject = opts.isUrgent
      ? `Urgent: API key "${opts.keyName}" expires tomorrow — Billinx`
      : `Action required: API key "${opts.keyName}" expires in ${opts.daysLeft} days`;

    const html = baseLayout(
      subject,
      urgentBadge +
        h1(
          opts.isUrgent
            ? 'Your API key expires tomorrow'
            : `Your API key expires in ${opts.daysLeft} days`,
        ) +
        p(`Hi ${opts.firstName},`) +
        p(
          `An API key for <strong>${opts.tenantName}</strong> is about to expire. ` +
            `Once it expires, any integrations using this key will stop working.`,
        ) +
        `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"
              style="background:#f8faf9;border:1px solid #dde3ec;border-radius:6px;margin:0 0 20px;">
          <tr><td style="padding:20px;">
            <div style="margin-bottom:12px;"><span style="font-size:12px;color:#8899aa;text-transform:uppercase;letter-spacing:1px;">Key Name</span><br /><strong style="color:${BRAND_DARK};">${opts.keyName}</strong></div>
            <div style="margin-bottom:12px;"><span style="font-size:12px;color:#8899aa;text-transform:uppercase;letter-spacing:1px;">Key Prefix</span><br /><code style="font-size:13px;color:${BRAND_DARK};">${opts.keyPrefix}...</code></div>
            <div><span style="font-size:12px;color:#8899aa;text-transform:uppercase;letter-spacing:1px;">Expires At</span><br /><strong style="color:#c0392b;">${new Date(opts.expiresAt).toUTCString()}</strong></div>
          </td></tr>
        </table>` +
        p(
          'Rotate this key now to create a new key and give yourself a 24-hour grace period on the old one. ' +
            'This ensures zero downtime for your integration.',
        ) +
        ctaButton(dashboardLink, 'Rotate API Key') +
        divider() +
        p(
          'You can also rotate this key via the API: ' +
            `<code>POST /v1/api-keys/{keyId}/rotate</code>`,
        ),
    );

    this.send(opts.to, subject, html);
  }

  // ─── 9. Account locked ───────────────────────────────────────────────────────

  sendAccountLocked(opts: {
    to: string;
    firstName: string;
    lockoutMinutes: number;
  }): void {
    const html = baseLayout(
      'Security alert — account locked',
      `<div style="display:inline-block;background:#fff3cd;border:1px solid #ffc107;border-radius:20px;padding:4px 14px;margin-bottom:20px;">
        <span style="font-size:12px;font-weight:600;color:#856404;text-transform:uppercase;letter-spacing:0.5px;">&#9888; Security Alert</span>
      </div>` +
        h1(`Hi ${opts.firstName}, your account has been locked`) +
        p(
          `Your Billinx account has been <strong>temporarily locked</strong> after 5 failed login attempts.`,
        ) +
        `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"
              style="background:#fff8e1;border:1px solid #ffe082;border-radius:6px;margin:0 0 20px;">
        <tr><td style="padding:20px;">
          <div style="margin-bottom:12px;">
            <span style="font-size:12px;color:#8899aa;text-transform:uppercase;letter-spacing:1px;">Unlock in</span><br />
            <strong style="font-size:18px;color:#856404;">${opts.lockoutMinutes} minute${opts.lockoutMinutes !== 1 ? 's' : ''}</strong>
          </div>
          <div>
            <span style="font-size:12px;color:#8899aa;text-transform:uppercase;letter-spacing:1px;">What to do</span><br />
            <span style="font-size:14px;color:#444;">Wait ${opts.lockoutMinutes} minute${opts.lockoutMinutes !== 1 ? 's' : ''}, then try again with your correct password. If you forgot your password, use the reset link below.</span>
          </div>
        </td></tr>
      </table>` +
        ctaButton(`${APP_BASE_URL}/forgot-password`, 'Reset Password') +
        divider() +
        p(
          '<strong>Was this not you?</strong> If you did not make these login attempts, your account may be under attack. Contact <a href="mailto:support@billinx.ng" style="color:' +
            BRAND_GREEN +
            ';">support@billinx.ng</a> immediately.',
        ),
    );

    this.send(
      opts.to,
      'Security alert — your Billinx account has been locked',
      html,
    );
  }
}
