import { Island } from '@/lib/island';
import type { SystemData } from '@/types';

export interface CheckInPageProps {
  data: SystemData;
  vapidPublicKey: string;
}

export function CheckInPage({ data, vapidPublicKey }: Readonly<CheckInPageProps>) {
  return (
    <>
      <title>Check-in - Dead Man's Switch</title>
      <Island name="CheckInContent" props={{ data, vapidPublicKey }} />
    </>
  );
}
