/**
 * Status chip label and tone per shift status, shared by the calendar day
 * sheet and the period detail screen.
 */
import type { ChipTone } from '../../components/Chip';
import type { ShiftStatus } from '../../engine/types';

export const STATUS_CHIP: Record<ShiftStatus, { label: string; tone: ChipTone }> = {
  planned: { label: 'Planned', tone: 'neutral' },
  worked: { label: 'Worked', tone: 'positive' },
  sick: { label: 'Sick', tone: 'alert' },
  holiday: { label: 'Holiday', tone: 'positive' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};
