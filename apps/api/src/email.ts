import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";

export type TransactionalEmailCategory = "status_link" | "proof_link" | "intake_verification" | "order" | "system";
export type TransactionalEmailMode = "log" | "ses";

export type TransactionalEmail = {
  to: string[];
  from?: string;
  replyTo?: string[];
  subject: string;
  text: string;
  html: string;
  category: TransactionalEmailCategory;
};

export type TransactionalEmailResult = {
  mode: TransactionalEmailMode;
  status: "logged" | "sent";
  provider_message_id?: string;
};

export type EmailRuntimeConfig = {
  mode: TransactionalEmailMode;
  from: string;
  statusReplyTo: string;
  proofReplyTo: string;
  ordersReplyTo: string;
  systemReplyTo: string;
  sesRegion: string;
  sesConfigurationSet?: string;
};

let sesClient: SESv2Client | undefined;

function getEnvString(name: string, fallback: string) {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

export function getEmailRuntimeConfig(): EmailRuntimeConfig {
  const configuredMode = getEnvString("PATHFINDER_STATUS_EMAIL_MODE", "log");

  if (configuredMode !== "log" && configuredMode !== "ses") {
    throw new Error(`Unsupported PATHFINDER_STATUS_EMAIL_MODE "${configuredMode}". Use "log" or "ses".`);
  }

  return {
    mode: configuredMode,
    from: getEnvString("PATHFINDER_EMAIL_FROM", "Vornan Updates <notifications@notify.vornan.co>"),
    statusReplyTo: getEnvString("PATHFINDER_STATUS_REPLY_TO", "support@vornan.co"),
    proofReplyTo: getEnvString("PATHFINDER_PROOF_REPLY_TO", "support@vornan.com"),
    ordersReplyTo: getEnvString("PATHFINDER_ORDERS_REPLY_TO", "orders@vornan.co"),
    systemReplyTo: getEnvString("PATHFINDER_SYSTEM_REPLY_TO", "ops@vornan.co"),
    sesRegion: getEnvString("PATHFINDER_SES_REGION", process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1"),
    sesConfigurationSet: process.env.PATHFINDER_SES_CONFIGURATION_SET?.trim() || undefined
  };
}

export function replyToForCategory(category: TransactionalEmailCategory, config = getEmailRuntimeConfig()) {
  if (category === "proof_link") {
    return config.proofReplyTo;
  }

  if (category === "order") {
    return config.ordersReplyTo;
  }

  if (category === "intake_verification") {
    return config.ordersReplyTo;
  }

  if (category === "system") {
    return config.systemReplyTo;
  }

  return config.statusReplyTo;
}

export function configurationSetForCategory(category: TransactionalEmailCategory, config = getEmailRuntimeConfig()) {
  return category === "proof_link" ? undefined : config.sesConfigurationSet;
}

function easternDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "America/New_York"
      }).format(date);
}

export function maskEmailAddress(email: string) {
  const [local = "", domain = ""] = email.split("@");

  if (!local || !domain) {
    return "invalid-email";
  }

  const visibleLocal = local.length <= 2 ? `${local.slice(0, 1)}*` : `${local.slice(0, 2)}***`;
  return `${visibleLocal}@${domain}`;
}

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildPublicIntakeVerificationEmail(args: {
  to: string;
  code: string;
  expiresAt: string;
  customerName: string;
}): TransactionalEmail {
  const config = getEmailRuntimeConfig();
  const expiresLabel = easternDateTime(args.expiresAt);
  const safeCode = escapeHtml(args.code);
  const safeCustomerName = escapeHtml(args.customerName);
  const safeExpiresLabel = escapeHtml(expiresLabel);

  return {
    to: [args.to],
    from: config.from,
    replyTo: [config.ordersReplyTo],
    category: "intake_verification",
    subject: `Your Vornan order upload code for ${args.customerName}`,
    text: [
      `Use this one-time code to continue uploading an order for ${args.customerName}:`,
      "",
      args.code,
      "",
      `This code expires ${expiresLabel}.`,
      "",
      "If you did not request this code, you can ignore this email."
    ].join("\n"),
    html: [
      "<!doctype html>",
      '<html lang="en">',
      '<body style="margin:0;background:#f7f8f5;font-family:Inter,Arial,sans-serif;color:#191818;">',
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f8f5;padding:36px 16px;">',
      '<tr><td align="center">',
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border:1px solid #dfe7da;border-radius:10px;overflow:hidden;">',
      '<tr><td style="padding:30px;">',
      '<div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#355b39;font-weight:800;">Vornan Pathfinder</div>',
      '<h1 style="font-size:27px;line-height:1.15;margin:12px 0 10px;color:#191818;">Verify your work email.</h1>',
      `<p style="font-size:16px;line-height:1.55;margin:0;color:#5c6859;">Use this one-time code to continue uploading an order for <strong>${safeCustomerName}</strong>.</p>`,
      `<div style="margin:24px 0;background:#f3f7ee;border:1px solid #d8e3ce;border-radius:8px;padding:18px;text-align:center;font-size:32px;line-height:1;letter-spacing:.22em;font-weight:800;color:#345738;">${safeCode}</div>`,
      `<p style="font-size:14px;line-height:1.5;margin:0;color:#6f796b;">This code expires ${safeExpiresLabel}.</p>`,
      '<p style="font-size:13px;line-height:1.5;margin:14px 0 0;color:#7b8477;">If you did not request this code, you can ignore this email.</p>',
      "</td></tr>",
      "</table>",
      "</td></tr>",
      "</table>",
      "</body>",
      "</html>"
    ].join("")
  };
}

export function buildStatusLinkEmail(args: {
  to: string;
  statusUrl: string;
  expiresAt: string;
  orderNumber?: string;
  orderNumbers?: string[];
  customerName?: string;
  customerNames?: string[];
}): TransactionalEmail {
  const config = getEmailRuntimeConfig();
  const expires = new Date(args.expiresAt);
  const expiresLabel = Number.isNaN(expires.getTime())
    ? args.expiresAt
    : new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "America/New_York"
      }).format(expires);
  const safeStatusUrl = escapeHtml(args.statusUrl);
  const safeExpiresLabel = escapeHtml(expiresLabel);
  const orderNumbers = Array.from(
    new Set((args.orderNumbers?.length ? args.orderNumbers : [args.orderNumber]).map((value) => value?.trim()).filter(Boolean))
  ) as string[];
  const customerNames = Array.from(
    new Set((args.customerNames?.length ? args.customerNames : [args.customerName]).map((value) => value?.trim()).filter(Boolean))
  ) as string[];
  const orderLabel = orderNumbers.length ? orderNumbers.join(", ") : "your order";
  const customerLabel = customerNames.length ? customerNames.join(", ") : "Vornan";
  const safeOrderLabel = escapeHtml(orderLabel);
  const safeCustomerLabel = escapeHtml(customerLabel);
  const subjectOrder =
    orderNumbers.length === 1 ? ` for ${orderNumbers[0]}` : orderNumbers.length > 1 ? ` for ${orderNumbers.length} orders` : "";
  const orderNoun = orderNumbers.length === 1 ? "order" : "orders";

  return {
    to: [args.to],
    from: config.from,
    replyTo: [config.statusReplyTo],
    category: "status_link",
    subject: `Your Vornan order status link${subjectOrder}`,
    text: [
      `A secure Vornan order status link was requested${orderNumbers.length ? ` for ${orderLabel}` : ""}.`,
      "",
      args.statusUrl,
      "",
      `This link expires ${expiresLabel}.`,
      "",
      "The status page can include order progress, proof files, package activity, and shipment details when those are available.",
      "",
      "If you did not request this link, you can ignore this email."
    ].join("\n"),
    html: [
      "<!doctype html>",
      '<html lang="en">',
      "<body style=\"margin:0;background:#f7f8f5;font-family:Inter,Arial,sans-serif;color:#191818;\">",
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f8f5;padding:36px 16px;">',
      "<tr><td align=\"center\">",
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #dfe7da;border-radius:8px;overflow:hidden;">',
      '<tr><td style="padding:28px 30px 18px;">',
      '<div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#355b39;font-weight:800;">Vornan</div>',
      '<h1 style="font-size:28px;line-height:1.15;margin:12px 0 10px;color:#191818;">Your order status link is ready.</h1>',
      `<p style="font-size:16px;line-height:1.55;margin:0;color:#5c6859;">Use this private link to view the latest available status details for your ${orderNoun}.</p>`,
      "</td></tr>",
      '<tr><td style="padding:0 30px 8px;">',
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #dfe7da;border-radius:8px;background:#f7f8f5;">',
      '<tr>',
      '<td style="padding:14px 16px;border-bottom:1px solid #dfe7da;">',
      `<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#758070;font-weight:800;">${orderNumbers.length === 1 ? "Order" : "Orders"}</div>`,
      `<div style="font-size:17px;line-height:1.35;margin-top:4px;color:#191818;font-weight:800;">${safeOrderLabel}</div>`,
      "</td>",
      '<td style="padding:14px 16px;border-bottom:1px solid #dfe7da;">',
      '<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#758070;font-weight:800;">Account</div>',
      `<div style="font-size:17px;line-height:1.35;margin-top:4px;color:#191818;font-weight:800;">${safeCustomerLabel}</div>`,
      "</td>",
      "</tr>",
      '<tr><td colspan="2" style="padding:14px 16px;">',
      '<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#758070;font-weight:800;">Status view may include</div>',
      '<div style="font-size:14px;line-height:1.55;margin-top:5px;color:#5c6859;">Order progress, proof files, package activity, and shipment details when available.</div>',
      "</td></tr>",
      "</table>",
      "</td></tr>",
      '<tr><td style="padding:4px 30px 26px;">',
      `<a href="${safeStatusUrl}" style="display:inline-block;background:#345738;color:#ffffff;text-decoration:none;font-weight:800;font-size:16px;padding:14px 18px;border-radius:6px;">View ${orderNumbers.length === 1 ? "order" : "orders"}</a>`,
      `<p style="font-size:14px;line-height:1.5;margin:20px 0 0;color:#6f796b;">This private link expires ${safeExpiresLabel}.</p>`,
      '<p style="font-size:13px;line-height:1.5;margin:14px 0 0;color:#7b8477;">If you did not request this link, you can ignore this email.</p>',
      "</td></tr>",
      "</table>",
      "</td></tr>",
      "</table>",
      "</body>",
      "</html>"
    ].join("")
  };
}

export function buildProofLinkEmail(args: {
  to: string;
  accessUrl: string;
  expiresAt: string;
  orderNumber: string;
  orderTitle?: string | null;
}): TransactionalEmail {
  const config = getEmailRuntimeConfig();
  const expiresLabel = easternDateTime(args.expiresAt);
  const title = args.orderTitle?.trim() || "Artwork proof review";
  const safeAccessUrl = escapeHtml(args.accessUrl);
  const safeExpiresLabel = escapeHtml(expiresLabel);
  const safeOrderNumber = escapeHtml(args.orderNumber);
  const safeTitle = escapeHtml(title);

  return {
    to: [args.to],
    from: config.from,
    replyTo: [config.proofReplyTo],
    category: "proof_link",
    subject: `Artwork proof ready for ${args.orderNumber}`,
    text: [
      `Artwork proofs for ${args.orderNumber} are ready for review.`,
      title,
      "",
      args.accessUrl,
      "",
      `This private, one-time link expires ${expiresLabel}. Do not forward it.`,
      "",
      "Vornan Proof is currently view-only. Approval and revision requests are unavailable.",
      "",
      "Questions? Reply to this email to contact Vornan support."
    ].join("\n"),
    html: [
      "<!doctype html>",
      '<html lang="en">',
      '<body style="margin:0;background:#f3f7f1;font-family:Inter,Arial,sans-serif;color:#191818;">',
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f7f1;padding:36px 16px;">',
      '<tr><td align="center">',
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border:1px solid #d8e1d3;border-radius:12px;overflow:hidden;">',
      '<tr><td style="padding:28px 30px 18px;">',
      '<div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#39523b;font-weight:800;">Vornan Proof</div>',
      '<h1 style="font-size:28px;line-height:1.15;margin:12px 0 10px;color:#191818;">Your artwork proof is ready.</h1>',
      '<p style="font-size:16px;line-height:1.55;margin:0;color:#5c6859;">Use the private link below to review the latest available proof files.</p>',
      '</td></tr>',
      '<tr><td style="padding:0 30px 18px;">',
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #d8e1d3;border-radius:8px;background:#f8faf5;">',
      `<tr><td style="padding:14px 16px;border-bottom:1px solid #d8e1d3;"><div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#758070;font-weight:800;">Order</div><div style="font-size:17px;line-height:1.35;margin-top:4px;font-weight:800;">${safeOrderNumber}</div></td></tr>`,
      `<tr><td style="padding:14px 16px;"><div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#758070;font-weight:800;">Proof packet</div><div style="font-size:15px;line-height:1.45;margin-top:4px;">${safeTitle}</div></td></tr>`,
      '</table>',
      '</td></tr>',
      '<tr><td style="padding:0 30px 28px;">',
      `<a href="${safeAccessUrl}" style="display:inline-block;background:#39523b;color:#fff;text-decoration:none;font-weight:800;font-size:16px;padding:14px 18px;border-radius:7px;">Review proofs</a>`,
      `<p style="font-size:14px;line-height:1.5;margin:20px 0 0;color:#5c6859;">This private, one-time link expires ${safeExpiresLabel}. Do not forward it.</p>`,
      '<p style="font-size:13px;line-height:1.5;margin:12px 0 0;color:#7b8477;">Vornan Proof is currently view-only. Approval and revision requests are unavailable.</p>',
      '</td></tr>',
      '</table>',
      '</td></tr>',
      '</table>',
      '</body>',
      '</html>'
    ].join("")
  };
}

export async function sendTransactionalEmail(email: TransactionalEmail): Promise<TransactionalEmailResult> {
  const config = getEmailRuntimeConfig();
  const from = email.from ?? config.from;
  const replyTo = email.replyTo ?? [replyToForCategory(email.category, config)];

  if (config.mode === "log") {
    console.info("[pathfinder-email-log]", {
      category: email.category,
      to_count: email.to.length,
      to: email.to.map(maskEmailAddress),
      subject: email.subject
    });
    return { mode: "log", status: "logged" };
  }

  sesClient ??= new SESv2Client({ region: config.sesRegion });

  const result = await sesClient.send(
    new SendEmailCommand({
      FromEmailAddress: from,
      Destination: {
        ToAddresses: email.to
      },
      ReplyToAddresses: replyTo,
      // Proof access URLs are bearer credentials. They intentionally bypass the
      // general configuration set so this application never opts them into
      // engagement/open/click tracking.
      ConfigurationSetName: configurationSetForCategory(email.category, config),
      EmailTags: [
        {
          Name: "message_type",
          Value: email.category
        }
      ],
      Content: {
        Simple: {
          Subject: {
            Charset: "UTF-8",
            Data: email.subject
          },
          Body: {
            Text: {
              Charset: "UTF-8",
              Data: email.text
            },
            Html: {
              Charset: "UTF-8",
              Data: email.html
            }
          }
        }
      }
    })
  );

  return {
    mode: "ses",
    status: "sent",
    provider_message_id: result.MessageId
  };
}
