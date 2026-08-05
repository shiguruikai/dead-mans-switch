import type { EmailSendBinding } from '../types';

export interface SendEmailOptions {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendEmail(
  emailSend: EmailSendBinding,
  options: SendEmailOptions,
): Promise<void> {
  await emailSend.send({
    from: options.from,
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html,
  });
}
