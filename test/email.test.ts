import { describe, expect, it, vi } from 'vitest';

import { parseEmailAddresses, sendEmail } from '@/services/email';

describe('メール処理モジュール（src/services/email.ts）', () => {
  describe('parseEmailAddresses', () => {
    it('単一のメールアドレスを正しくパースできること', () => {
      const result = parseEmailAddresses('owner@example.com');
      expect(result).toEqual(['owner@example.com']);
    });

    it('カンマ区切りの複数メールアドレスを正しくパースできること', () => {
      const result = parseEmailAddresses('kin1@example.com, kin2@example.com,kin3@example.com');
      expect(result).toEqual(['kin1@example.com', 'kin2@example.com', 'kin3@example.com']);
    });

    it('全角カンマやセミコロン区切りのメールアドレスを正しくパースできること', () => {
      const result = parseEmailAddresses('kin1@example.com; kin2@example.com、kin3@example.com，kin4@example.com');
      expect(result).toEqual([
        'kin1@example.com',
        'kin2@example.com',
        'kin3@example.com',
        'kin4@example.com',
      ]);
    });

    it('空白のトリム、空値の除外、重複アドレスの除去が行われること', () => {
      const result = parseEmailAddresses('  a@example.com , b@example.com;, a@example.com  ,  ');
      expect(result).toEqual(['a@example.com', 'b@example.com']);
    });

    it('空文字列や空白のみの場合は空配列を返すこと', () => {
      expect(parseEmailAddresses('')).toEqual([]);
      expect(parseEmailAddresses('   ')).toEqual([]);
    });
  });

  describe('sendEmail', () => {
    it('複数の宛先に対して個別に並列送信が行われること', async () => {
      const sendMock = vi.fn().mockResolvedValue(undefined);
      const emailSendBinding = { send: sendMock } as any;

      const result = await sendEmail(emailSendBinding, {
        from: 'noreply@example.com',
        to: 'kin1@example.com, kin2@example.com',
        subject: 'テスト件名',
        text: 'テスト本文',
      });

      expect(result).toEqual({ successCount: 2, failureCount: 0 });
      expect(sendMock).toHaveBeenCalledTimes(2);
      expect(sendMock).toHaveBeenCalledWith({
        from: 'noreply@example.com',
        to: 'kin1@example.com',
        subject: 'テスト件名',
        text: 'テスト本文',
        html: undefined,
      });
      expect(sendMock).toHaveBeenCalledWith({
        from: 'noreply@example.com',
        to: 'kin2@example.com',
        subject: 'テスト件名',
        text: 'テスト本文',
        html: undefined,
      });
    });

    it('少なくとも1つの宛先への送信が成功すれば結果が成功扱いとなること', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* noop */ });
      const sendMock = vi.fn().mockImplementation(({ to }) => {
        if (to === 'failed@example.com') {
          return Promise.reject(new Error('Failed delivery'));
        }
        return Promise.resolve(undefined);
      });
      const emailSendBinding = { send: sendMock } as any;

      const result = await sendEmail(emailSendBinding, {
        from: 'noreply@example.com',
        to: 'failed@example.com, success@example.com',
        subject: 'テスト件名',
        text: 'テスト本文',
      });

      expect(result).toEqual({ successCount: 1, failureCount: 1 });
      expect(sendMock).toHaveBeenCalledTimes(2);
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('全宛先への送信が失敗した場合は例外がスローされること', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* noop */ });
      const sendMock = vi.fn().mockRejectedValue(new Error('Delivery error'));
      const emailSendBinding = { send: sendMock } as any;

      await expect(
        sendEmail(emailSendBinding, {
          from: 'noreply@example.com',
          to: 'kin1@example.com, kin2@example.com',
          subject: 'テスト件名',
          text: 'テスト本文',
        }),
      ).rejects.toThrow('Failed to send email to all recipients');

      expect(sendMock).toHaveBeenCalledTimes(2);
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('宛先リストが空の場合は例外がスローされること', async () => {
      const emailSendBinding = { send: vi.fn() } as any;

      await expect(
        sendEmail(emailSendBinding, {
          from: 'noreply@example.com',
          to: '',
          subject: 'テスト件名',
          text: 'テスト本文',
        }),
      ).rejects.toThrow('No recipient email addresses provided');
    });
  });
});
