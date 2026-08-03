import { EmailMessage } from 'cloudflare:email';
import { createMimeMessage } from 'mimetext';

import type { Env } from '../types';

export async function sendEmail(
  env: Env,
  options: { to: string; subject: string; bodyTemplate: string },
): Promise<void> {
  const formattedBody = options.bodyTemplate.replaceAll('${BASE_URL}', env.BASE_URL);

  const msg = createMimeMessage();
  msg.setSender({ name: "Dead Man's Switch", addr: env.SENDER_EMAIL_ADDRESS });
  msg.setRecipient(options.to);
  msg.setSubject(options.subject);
  msg.addMessage({ contentType: 'text/plain', data: formattedBody });

  const message = new EmailMessage(env.SENDER_EMAIL_ADDRESS, options.to, msg.asRaw());

  await env.EMAIL_SEND.send(message);
}
