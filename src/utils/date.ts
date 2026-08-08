export const MS_PER_SECOND = 1000;
export const MS_PER_DAY = 86_400_000;

/**
 * 与えられた Date オブジェクトまたは日付文字列が有効な日付（Valid Date）かどうかを判定します。
 */
export function isValidDate(dateInput: Date | string): boolean {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  return !Number.isNaN(date.getTime());
}

/**
 * 指定された日時から指定された日数前の Date オブジェクトを取得します。
 */
export function subDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() - days);
  return result;
}

/**
 * 指定された日時から指定された日数前の ISO 日付文字列を取得します。
 */
export function subDaysIso(days: number, relativeTo: Date = new Date()): string {
  return subDays(relativeTo, days).toISOString();
}

/**
 * 指定された ISO 日付文字列から指定日時（デフォルトは現在）までの経過日数を計算します。
 */
export function getDaysSince(isoDateString: string, now: Date = new Date()): number {
  if (!isValidDate(isoDateString)) {
    return 0;
  }
  const date = new Date(isoDateString);
  return Math.floor((now.getTime() - date.getTime()) / MS_PER_DAY);
}

/**
 * 指定された ISO 日付文字列から指定日時（デフォルトは現在）までの経過秒数を計算します。
 */
export function getSecondsSince(isoDateString: string, now: Date = new Date()): number {
  if (!isValidDate(isoDateString)) {
    return 0;
  }
  const date = new Date(isoDateString);
  return (now.getTime() - date.getTime()) / MS_PER_SECOND;
}

/**
 * ISO 日付文字列を日本時間のフォーマット文字列へ変換します。
 */
export function formatJapaneseDateTime(isoDateString: string): string {
  if (!isValidDate(isoDateString)) {
    return isoDateString;
  }
  const date = new Date(isoDateString);
  return date.toLocaleString('ja-JP');
}
