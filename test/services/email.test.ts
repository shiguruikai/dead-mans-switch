import { describe, expect, it, vi } from 'vitest';

import { sendEmail } from '@/services/email';

describe('メール送信サービス（src/services/email.ts）', () => {
  it('Cloudflare Email Send バインディングを正しいペイロードで呼び出すこと', async () => {
    const mockEmailSend: SendEmail = {
      send: vi.fn().mockResolvedValue(undefined),
    };

    await sendEmail(mockEmailSend, {
      from: 'noreply@example.com',
      to: 'user@example.com',
      subject: 'テスト件名',
      text: 'テスト本文',
    });

    expect(mockEmailSend.send).toHaveBeenCalledTimes(1);
    expect(mockEmailSend.send).toHaveBeenCalledWith({
      from: 'noreply@example.com',
      to: 'user@example.com',
      subject: 'テスト件名',
      text: 'テスト本文',
      html: undefined,
    });
  });
});
