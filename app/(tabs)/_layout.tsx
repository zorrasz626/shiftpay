import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Redirect, Tabs } from 'expo-router';
import { type ComponentProps, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useJobsStore } from '../../src/store/jobsStore';
import { needsOnboarding, useOnboardingStore } from '../../src/store/onboardingStore';
import { useSettingsStore } from '../../src/store/settingsStore';
import { useTheme } from '../../src/theme/useTheme';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

const ICON_SIZE = 24;
const MARKER_HEIGHT = 3;
const MARKER_GAP = 5;
/** Bar height above the safe-area inset; each tab is the full height, well over 48dp. */
const TAB_BAR_HEIGHT = 64;

/** Tab icon with the active marker: a 3px signal bar above the icon (transparent when inactive). */
function TabIcon({ name, focused }: { name: IconName; focused: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={styles.iconColumn}>
      <View style={[styles.marker, { backgroundColor: focused ? colors.signal : 'transparent' }]} />
      <MaterialCommunityIcons
        name={name}
        size={ICON_SIZE}
        color={focused ? colors.ink : colors.inkMuted}
      />
    </View>
  );
}

/** `tabBarIcon` option for a tab; the tint colours are taken from the theme in TabIcon. */
function icon(name: IconName) {
  const renderTabIcon = ({ focused }: { focused: boolean }) => (
    <TabIcon name={name} focused={focused} />
  );
  return renderTabIcon;
}

export default function TabsLayout() {
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const onboarding = needsOnboarding(useSettingsStore((s) => s.values));
  const existingJob = useJobsStore((s) => s.jobs[0]);
  const draftJobId = useOnboardingStore((s) => s.jobId);

  // First run, or onboarding quit after step 2: resume with the saved job so
  // step 2 updates it instead of creating another (free tier = 1 job).
  useEffect(() => {
    if (!onboarding || existingJob === undefined) return;
    const draft = useOnboardingStore.getState();
    if (draft.jobId === undefined) draft.loadFromJob(existingJob);
  }, [onboarding, existingJob]);

  if (onboarding) {
    // Wait one render for loadFromJob, so step 1 opens already prefilled.
    const ready = existingJob === undefined || draftJobId !== undefined;
    return ready ? <Redirect href="/onboarding/job" /> : null;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.board },
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarActiveBackgroundColor: 'transparent',
        tabBarInactiveBackgroundColor: 'transparent',
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.line,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: TAB_BAR_HEIGHT + insets.bottom,
        },
        tabBarItemStyle: { paddingTop: spacing.xs },
        tabBarIconStyle: styles.iconSlot,
        tabBarLabelStyle: {
          fontFamily: typography.bodyMedium.fontFamily,
          fontSize: typography.caption.fontSize,
          lineHeight: typography.caption.lineHeight,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home-outline') }} />
      <Tabs.Screen
        name="calendar"
        options={{ title: 'Calendar', tabBarIcon: icon('calendar-month-outline') }}
      />
      <Tabs.Screen name="pay" options={{ title: 'Pay', tabBarIcon: icon('cash') }} />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: icon('cog-outline') }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconSlot: { width: 48, height: MARKER_HEIGHT + MARKER_GAP + ICON_SIZE },
  iconColumn: { alignItems: 'center' },
  marker: { width: 32, height: MARKER_HEIGHT, borderRadius: 2, marginBottom: MARKER_GAP },
});
