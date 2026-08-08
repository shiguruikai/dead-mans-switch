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
 * 2 つの日時の差分日数（later - earlier）を計算します。
 * いずれかが無効な日時の場合は 0 を返します。
 */
export function differenceInDays(later: Date, earlier: Date): number {
  if (!isValidDate(later) || !isValidDate(earlier)) {
    return 0;
  }
  return Math.floor((later.getTime() - earlier.getTime()) / MS_PER_DAY);
}

/**
 * 2 つの日時の差分秒数（later - earlier）を計算します。
 * いずれかが無効な日時の場合は 0 を返します。
 */
export function differenceInSeconds(later: Date, earlier: Date): number {
  if (!isValidDate(later) || !isValidDate(earlier)) {
    return 0;
  }
  return (later.getTime() - earlier.getTime()) / MS_PER_SECOND;
}
