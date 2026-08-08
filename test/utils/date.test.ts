import { describe, expect, it } from 'vitest';

import {
  differenceInDays,
  differenceInSeconds,
  isValidDate,
  MS_PER_DAY,
  MS_PER_SECOND,
  subDays,
} from '@/utils/date';

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

  describe('subDays', () => {
    it('指定した日数前の Date オブジェクトを正しく計算できること', () => {
      const base = new Date('2026-08-10T12:00:00.000Z');
      const result = subDays(base, 3);
      expect(result.toISOString()).toBe('2026-08-07T12:00:00.000Z');
    });
  });

  describe('differenceInDays', () => {
    it('差分日数を正しく計算できること', () => {
      const now = new Date('2026-08-10T12:00:00.000Z');
      const past = new Date('2026-08-07T12:00:00.000Z');
      expect(differenceInDays(now, past)).toBe(3);
    });

    it('不正な Date オブジェクトが含まれる場合は 0 を返すこと', () => {
      expect(differenceInDays(new Date('invalid-date'), new Date())).toBe(0);
      expect(differenceInDays(new Date(), new Date('invalid-date'))).toBe(0);
    });
  });

  describe('differenceInSeconds', () => {
    it('差分秒数を正しく計算できること', () => {
      const now = new Date('2026-08-07T12:01:40.000Z');
      const past = new Date('2026-08-07T12:00:00.000Z');
      expect(differenceInSeconds(now, past)).toBe(100);
    });

    it('不正な Date オブジェクトが含まれる場合は 0 を返すこと', () => {
      expect(differenceInSeconds(new Date('invalid-date'), new Date())).toBe(0);
      expect(differenceInSeconds(new Date(), new Date('invalid-date'))).toBe(0);
    });
  });
});
