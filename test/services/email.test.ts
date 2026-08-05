import { describe, expect, it, vi } from 'vitest';

import { sendEmail } from '../../src/services/email';
import type { EmailSendBinding } from '../../src/types';

describe('sendEmail service', () => {
  it('should call emailSend.send with correct EmailMessageBuilder payload', async () => {
    const mockEmailSend: EmailSendBinding = {
      send: vi.fn().mockResolvedValue(undefined),
    };

    await sendEmail(mockEmailSend, {
      from: 'noreply@example.com',
      to: 'user@example.com',
      subject: 'Test Subject',
      text: 'Test Body',
    });

    expect(mockEmailSend.send).toHaveBeenCalledTimes(1);
    expect(mockEmailSend.send).toHaveBeenCalledWith({
      from: 'noreply@example.com',
      to: 'user@example.com',
      subject: 'Test Subject',
      text: 'Test Body',
      html: undefined,
    });
  });
});
