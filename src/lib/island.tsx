import type { PropsWithChildren } from 'hono/jsx';

import { CheckInContent } from '@/islands/CheckInContent';

// クライアント側でハイドレート可能な Island コンポーネントのレジストリ
export const islands = {
  CheckInContent,
} as const;

export type IslandName = keyof typeof islands;

export function isIslandName(value: unknown): value is IslandName {
  return typeof value === 'string' && value in islands;
}

export interface IslandProps<N extends IslandName> extends PropsWithChildren {
  name: N;
  props?: Parameters<typeof islands[N]>[0];
}

export function Island<N extends IslandName>({ name, props, children }: Readonly<IslandProps<N>>) {
  return (
    <div data-island={name} data-props={JSON.stringify(props ?? {})}>
      {children}
    </div>
  );
}
