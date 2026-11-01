/**
 * The single gate for Pro features (SPEC §8). While the entitlement is still
 * loading, the user is treated as Free.
 */
import { type ProStatus, useProStore } from './proStore';

export interface Entitlement {
  isPro: boolean;
  status: ProStatus;
}

export function useEntitlement(): Entitlement {
  const status = useProStore((s) => s.status);
  return { isPro: status === 'pro', status };
}
