import { describe, expect, it, vi } from 'vitest';

import { parseEmailAddresses, sendEmail } from '../src/services/email';

describe('Email Service (src/services/email.ts)', () => {
  describe('parseEmailAddresses', () => {
    it('should parse single email address', () => {
      const result = parseEmailAddresses('owner@example.com');
      expect(result).toEqual(['owner@example.com']);
    });

    it('should parse multiple comma-separated email addresses', () => {
      const result = parseEmailAddresses('kin1@example.com, kin2@example.com,kin3@example.com');
      expect(result).toEqual(['kin1@example.com', 'kin2@example.com', 'kin3@example.com']);
    });

    it('should parse email addresses separated by full-width commas and semicolons', () => {
      const result = parseEmailAddresses('kin1@example.com; kin2@example.com、kin3@example.com，kin4@example.com');
      expect(result).toEqual([
        'kin1@example.com',
        'kin2@example.com',
        'kin3@example.com',
        'kin4@example.com',
      ]);
    });

    it('should trim whitespace, filter empty values, and deduplicate addresses', () => {
      const result = parseEmailAddresses('  a@example.com , b@example.com;, a@example.com  ,  ');
      expect(result).toEqual(['a@example.com', 'b@example.com']);
    });

    it('should return empty array for empty string or whitespace', () => {
      expect(parseEmailAddresses('')).toEqual([]);
      expect(parseEmailAddresses('   ')).toEqual([]);
    });
  });

  describe('sendEmail', () => {
    it('should send email to multiple recipients individually in parallel', async () => {
      const sendMock = vi.fn().mockResolvedValue(undefined);
      const emailSendBinding = { send: sendMock } as any;

      const result = await sendEmail(emailSendBinding, {
        from: 'noreply@example.com',
        to: 'kin1@example.com, kin2@example.com',
        subject: 'Test Subject',
        text: 'Test Body',
      });

      expect(result).toEqual({ successCount: 2, failureCount: 0 });
      expect(sendMock).toHaveBeenCalledTimes(2);
      expect(sendMock).toHaveBeenCalledWith({
        from: 'noreply@example.com',
        to: 'kin1@example.com',
        subject: 'Test Subject',
        text: 'Test Body',
        html: undefined,
      });
      expect(sendMock).toHaveBeenCalledWith({
        from: 'noreply@example.com',
        to: 'kin2@example.com',
        subject: 'Test Subject',
        text: 'Test Body',
        html: undefined,
      });
    });

    it('should succeed if at least one recipient receives email', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
        // Suppress console.error during test
      });
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
        subject: 'Test Subject',
        text: 'Test Body',
      });

      expect(result).toEqual({ successCount: 1, failureCount: 1 });
      expect(sendMock).toHaveBeenCalledTimes(2);
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('should throw error if all recipient deliveries fail', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
        // Suppress console.error during test
      });
      const sendMock = vi.fn().mockRejectedValue(new Error('Delivery error'));
      const emailSendBinding = { send: sendMock } as any;

      await expect(
        sendEmail(emailSendBinding, {
          from: 'noreply@example.com',
          to: 'fail1@example.com, fail2@example.com',
          subject: 'Test Subject',
          text: 'Test Body',
        }),
      ).rejects.toThrow('Failed to send email to all recipients (fail1@example.com, fail2@example.com)');
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('should throw error if no recipients provided', async () => {
      const sendMock = vi.fn();
      const emailSendBinding = { send: sendMock } as any;

      await expect(
        sendEmail(emailSendBinding, {
          from: 'noreply@example.com',
          to: ' , , ',
          subject: 'Test Subject',
          text: 'Test Body',
        }),
      ).rejects.toThrow('No recipient email addresses provided');
    });
  });
});
