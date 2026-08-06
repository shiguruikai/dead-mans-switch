import { describe, expect, it } from 'vitest';

import {
  formatJapaneseDateTime,
  getDaysSince,
  getSecondsSince,
  isValidDate,
  MS_PER_DAY,
  MS_PER_SECOND,
} from '../../src/utils/date';

describe('日付・時間ユーティリティ（src/utils/date.ts）', () => {
  it('時間に関する定数が正しく定義されていること', () => {
    expect(MS_PER_SECOND).toBe(1000);
    expect(MS_PER_DAY).toBe(86400000);
  });

  describe('isValidDate', () => {
    it('有効な ISO 日付文字列や Date オブジェクトで true を返すこと', () => {
      expect(isValidDate('2026-08-07T00:00:00.000Z')).toBe(true);
      expect(isValidDate(new Date())).toBe(true);
    });

    it('不正な日付文字列で false を返すこと', () => {
      expect(isValidDate('invalid-date-string')).toBe(false);
    });
  });

  describe('getDaysSince', () => {
    it('経過日数を正しく計算できること', () => {
      const now = new Date('2026-08-10T12:00:00.000Z');
      const past = '2026-08-07T12:00:00.000Z';
      expect(getDaysSince(past, now)).toBe(3);
    });

    it('不正な日付文字列の場合は 0 を返すこと', () => {
      expect(getDaysSince('invalid-date')).toBe(0);
    });
  });

  describe('getSecondsSince', () => {
    it('経過秒数を正しく計算できること', () => {
      const now = new Date('2026-08-07T12:01:40.000Z');
      const past = '2026-08-07T12:00:00.000Z';
      expect(getSecondsSince(past, now)).toBe(100);
    });

    it('不正な日付文字列の場合は 0 を返すこと', () => {
      expect(getSecondsSince('invalid-date')).toBe(0);
    });
  });

  describe('formatJapaneseDateTime', () => {
    it('有効な ISO 文字列を日本時間の文字列へフォーマットできること', () => {
      const formatted = formatJapaneseDateTime('2026-08-07T00:00:00.000Z');
      expect(formatted).toBeDefined();
      expect(typeof formatted).toBe('string');
      expect(formatted).toContain('2026');
    });

    it('不正な日付文字列の場合は元の文字列を返すこと', () => {
      expect(formatJapaneseDateTime('invalid-date')).toBe('invalid-date');
    });
  });
});
