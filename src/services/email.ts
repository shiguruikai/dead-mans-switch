export interface SendEmailOptions {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendEmailResult {
  sentTo: string[];
  failedTo: string[];
}

/**
 * カンマ（半角・全角）やセミコロン区切りのメールアドレス文字列をパースし、
 * トリム・空文字除外・重複排除した配列を返します。
 */
export function parseEmailAddresses(rawAddresses: string): string[] {
  if (!rawAddresses) return [];
  const addresses = rawAddresses
    .split(/[,;、，]+/)
    .map((addr) => addr.trim())
    .filter((addr) => addr.length > 0);
  return Array.from(new Set(addresses));
}

/**
 * 単一または複数宛先へ並列でメールを送信し、送信を受け付けられた宛先と失敗した宛先を返します。
 * 少なくとも1件以上の送信が成功した場合、正常終了と見なします。
 * 1件も成功しなかった場合はエラーをスローします。
 */
export async function sendEmail(
  emailSend: SendEmail,
  options: SendEmailOptions,
): Promise<SendEmailResult> {
  const recipients = parseEmailAddresses(options.to);
  if (recipients.length === 0) {
    throw new Error('No recipient email addresses provided');
  }

  const results = await Promise.allSettled(
    recipients.map((recipient) =>
      emailSend.send({
        from: options.from,
        to: recipient,
        subject: options.subject,
        text: options.text,
        html: options.html,
      }),
    ),
  );

  const sentTo: string[] = [];
  const failedTo: string[] = [];

  results.forEach((result, index) => {
    const recipient = recipients[index];
    if (result.status === 'fulfilled') {
      sentTo.push(recipient);
    } else {
      failedTo.push(recipient);
      console.error(`Failed to send email to ${recipient}:`, result.reason);
    }
  });

  if (sentTo.length === 0) {
    throw new Error(`Failed to send email to all recipients (${recipients.join(', ')})`);
  }

  return { sentTo, failedTo };
}
