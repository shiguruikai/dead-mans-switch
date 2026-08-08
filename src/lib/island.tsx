import type { FC } from 'hono/jsx';

import { CheckInContent } from '@/islands/CheckInContent';

/**
 * クライアントハイドレート可能な Island コンポーネントのレジストリ
 */
export const islands = {
  CheckInContent,
} as const;

export type IslandName = keyof typeof islands;

export function isIslandName(value: unknown): value is IslandName {
  return typeof value === 'string' && value in islands;
}

/**
 * <Island> コンポーネントの Props 型定義
 */
export interface IslandProps<N extends IslandName> {
  name: N;
  props?: Parameters<typeof islands[N]>[0];
}

/**
 * Hono JSX SSR 環境で部分ハイドレーション（Island アーキテクチャ）を実現するラッパーコンポーネント。
 * レジストリ（islands）からコンポーネントを取得して SSR 描画し、二重記述を防止する。
 *
 * @example
 * ```tsx
 * <Island name="CheckInContent" props={{ data, vapidPublicKey }} />
 * ```
 */
export function Island<N extends IslandName>({ name, props }: Readonly<IslandProps<N>>) {
  const Component = islands[name] as FC;

  return (
    <div data-island={name} data-props={JSON.stringify(props ?? {})}>
      <Component {...(props ?? {})} />
    </div>
  );
}
