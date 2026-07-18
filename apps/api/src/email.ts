import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";

export type TransactionalEmailCategory = "status_link" | "order" | "system";
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

type EmailRuntimeConfig = {
  mode: TransactionalEmailMode;
  from: string;
  statusReplyTo: string;
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
    ordersReplyTo: getEnvString("PATHFINDER_ORDERS_REPLY_TO", "orders@vornan.co"),
    systemReplyTo: getEnvString("PATHFINDER_SYSTEM_REPLY_TO", "ops@vornan.co"),
    sesRegion: getEnvString("PATHFINDER_SES_REGION", process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1"),
    sesConfigurationSet: process.env.PATHFINDER_SES_CONFIGURATION_SET?.trim() || undefined
  };
}

export function replyToForCategory(category: TransactionalEmailCategory, config = getEmailRuntimeConfig()) {
  if (category === "order") {
    return config.ordersReplyTo;
  }

  if (category === "system") {
    return config.systemReplyTo;
  }

  return config.statusReplyTo;
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

export function buildStatusLinkEmail(args: {
  to: string;
  statusUrl: string;
  expiresAt: string;
  orderNumber?: string;
  customerName?: string;
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
  const safeOrderNumber = escapeHtml(args.orderNumber?.trim() || "your order");
  const safeCustomerName = escapeHtml(args.customerName?.trim() || "Vornan");
  const subjectOrder = args.orderNumber?.trim() ? ` for ${args.orderNumber.trim()}` : "";

  return {
    to: [args.to],
    from: config.from,
    replyTo: [config.statusReplyTo],
    category: "status_link",
    subject: `Your Vornan order status link${subjectOrder}`,
    text: [
      `A secure Vornan order status link was requested${args.orderNumber ? ` for ${args.orderNumber}` : ""}.`,
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
      `<p style="font-size:16px;line-height:1.55;margin:0;color:#5c6859;">Use this private link to view the latest available status details for <strong style="color:#191818;">${safeOrderNumber}</strong>.</p>`,
      "</td></tr>",
      '<tr><td style="padding:0 30px 8px;">',
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #dfe7da;border-radius:8px;background:#f7f8f5;">',
      '<tr>',
      '<td style="padding:14px 16px;border-bottom:1px solid #dfe7da;">',
      '<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#758070;font-weight:800;">Order</div>',
      `<div style="font-size:17px;line-height:1.35;margin-top:4px;color:#191818;font-weight:800;">${safeOrderNumber}</div>`,
      "</td>",
      '<td style="padding:14px 16px;border-bottom:1px solid #dfe7da;">',
      '<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#758070;font-weight:800;">Account</div>',
      `<div style="font-size:17px;line-height:1.35;margin-top:4px;color:#191818;font-weight:800;">${safeCustomerName}</div>`,
      "</td>",
      "</tr>",
      '<tr><td colspan="2" style="padding:14px 16px;">',
      '<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#758070;font-weight:800;">Status view may include</div>',
      '<div style="font-size:14px;line-height:1.55;margin-top:5px;color:#5c6859;">Order progress, proof files, package activity, and shipment details when available.</div>',
      "</td></tr>",
      "</table>",
      "</td></tr>",
      '<tr><td style="padding:4px 30px 26px;">',
      `<a href="${safeStatusUrl}" style="display:inline-block;background:#345738;color:#ffffff;text-decoration:none;font-weight:800;font-size:16px;padding:14px 18px;border-radius:6px;">View order status</a>`,
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
      ConfigurationSetName: config.sesConfigurationSet,
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
