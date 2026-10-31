/**
 * Holiday entitlement ring (SPEC screen 6). No SVG in the project, so the ring
 * is a circle of small dots: taken first, then booked, then the remaining
 * track, clockwise from 12 o'clock. Remaining hours sit in the centre.
 */
import { StyleSheet, Text, View } from 'react-native';

import { formatHolidayHours, type HolidayView } from '../../engine/holidayView';
import { tabularNums } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';

const DOTS = 40;
const SIZE = 220;
const DOT = 12;
const RADIUS = (SIZE - DOT) / 2;

/** How many dots are taken and booked (booked never overlaps taken). */
function dotCounts(ring: HolidayView['ring']): { taken: number; booked: number } {
  const taken = Math.round(ring.takenFraction * DOTS);
  const booked = Math.round((ring.takenFraction + ring.bookedFraction) * DOTS) - taken;
  return { taken, booked: Math.max(0, booked) };
}

function hoursOf(view: HolidayView, key: 'entitled' | 'taken' | 'booked'): string {
  const row = view.rows.find((r) => r.key === key);
  return formatHolidayHours(row === undefined ? 0 : row.hours);
}

export function HolidayRing({ view }: { view: HolidayView }) {
  const { colors, typography, spacing } = useTheme();
  const { taken, booked } = dotCounts(view.ring);
  const label =
    `Holiday: ${view.remainingLabel}. Entitled ${hoursOf(view, 'entitled')}, ` +
    `taken ${hoursOf(view, 'taken')}, booked ${hoursOf(view, 'booked')}.`;

  const dots = Array.from({ length: DOTS }, (_, i) => {
    const angle = (2 * Math.PI * i) / DOTS;
    const color = i < taken ? colors.night : i < taken + booked ? colors.signal : colors.line;
    return (
      <View
        key={i}
        style={[
          styles.dot,
          {
            left: SIZE / 2 + RADIUS * Math.sin(angle) - DOT / 2,
            top: SIZE / 2 - RADIUS * Math.cos(angle) - DOT / 2,
            backgroundColor: color,
          },
        ]}
      />
    );
  });

  const legend: { name: string; color: string }[] = [
    { name: 'Taken', color: colors.night },
    { name: 'Booked', color: colors.signal },
    { name: 'Remaining', color: colors.line },
  ];

  return (
    <View style={styles.centre}>
      <View
        testID="holiday-ring"
        accessible
        accessibilityRole="image"
        accessibilityLabel={label}
        style={styles.ring}
      >
        {dots}
        <View style={[styles.middle, { padding: DOT + spacing.md }]}>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            style={[typography.display, styles.nums, styles.text, { color: colors.ink }]}
          >
            {view.remainingLabel}
          </Text>
        </View>
      </View>
      <View style={[styles.legend, { marginTop: spacing.md }]}>
        {legend.map((l) => (
          <View key={l.name} style={[styles.legendItem, { marginHorizontal: spacing.sm }]}>
            <View style={[styles.swatch, { backgroundColor: l.color, marginRight: spacing.xs }]} />
            <Text style={[typography.caption, { color: colors.inkMuted }]}>{l.name}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { alignItems: 'center' },
  ring: { width: SIZE, height: SIZE },
  dot: { position: 'absolute', width: DOT, height: DOT, borderRadius: DOT / 2 },
  middle: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  nums: { fontVariant: [...tabularNums] },
  text: { textAlign: 'center' },
  legend: { flexDirection: 'row', justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
  swatch: { width: DOT, height: DOT, borderRadius: DOT / 2 },
});
