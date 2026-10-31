import { Stack } from 'expo-router';

/** Onboarding steps: a plain stack with no header (each step shows its own title). */
export default function OnboardingLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
