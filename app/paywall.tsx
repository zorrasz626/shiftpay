/**
 * Paywall (SPEC §7.9, §8): the Pro benefits, one option per package of the
 * current RevenueCat offering (prices and trials from the store, never
 * hard-coded), buy and restore. Pro is shown only when the entitlement store
 * says so (fail closed): a purchase or restore re-reads the customer info
 * through the store. Without an API key, or when the offering can't be
 * loaded, the screen says purchases aren't available instead.
 */
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Disclaimer } from '../src/components/Disclaimer';
import { Screen } from '../src/components/Screen';
import {
  type PaywallOption,
  defaultOption,
  isUserCancelled,
  paywallOptions,
} from '../src/features/pro/paywallModel';
import { useProStore } from '../src/features/pro/proStore';
import {
  type PurchasesClient,
  hasProEntitlement,
  revenueCatApiKey,
  revenueCatClient,
} from '../src/features/pro/purchases';
import { useEntitlement } from '../src/features/pro/useEntitlement';
import { tabularNums } from '../src/theme/tokens';
import { useTheme } from '../src/theme/useTheme';

/** SPEC §8 Pro column (the widget comes later, so it isn't listed). */
export const PRO_BENEFITS = [
  'Unlimited jobs and rota patterns',
  'Estimated net pay (tax, NI, pension, student loan)',
  'Unlimited premium and overtime rules',
  'Line-by-line payslip check, with PDF and CSV export',
  'Stats and charts',
  'Backup to file',
] as const;

export const UNAVAILABLE_MESSAGE = "Purchases aren't available right now. Try again later.";
export const PURCHASE_FAILED_MESSAGE = "The purchase didn't go through. Try again.";
export const PURCHASE_PENDING_MESSAGE =
  'Your purchase is being processed. Pro will turn on when Google Play confirms it.';
export const RESTORE_DONE_MESSAGE = 'Pro restored.';
export const RESTORE_NONE_MESSAGE = 'No purchases found.';
export const RESTORE_FAILED_MESSAGE = "Purchases couldn't be restored. Try again.";

type Offer =
  | { state: 'loading' }
  | { state: 'unavailable' }
  | { state: 'ready'; options: PaywallOption[] };

type Message = { text: string; tone: 'positive' | 'alert' };

export type PaywallViewProps = {
  readonly client: PurchasesClient;
  /** Null → RevenueCat isn't configured: no SDK calls, the unavailable state. */
  readonly apiKey: string | null;
};

/** Primary button label for the selected plan. */
function buyLabel(option: PaywallOption): string {
  if (option.trialLabel !== null) return `Start ${option.trialLabel}`;
  return option.kind === 'lifetime' ? 'Buy lifetime' : 'Subscribe';
}

/** One plan, selectable as a radio row, at least 48dp tall. */
function PlanRow({
  option,
  selected,
  disabled,
  onPress,
}: {
  option: PaywallOption;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors, typography, spacing, radius } = useTheme();
  const name = [option.title, option.priceLabel, option.trialLabel].filter(Boolean).join(', ');
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={name}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.plan,
        {
          borderRadius: radius.card,
          borderColor: selected ? colors.signal : colors.line,
          borderWidth: selected ? 2 : 1,
          padding: spacing.md,
          marginBottom: spacing.sm,
          backgroundColor: colors.surface,
        },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.planRow}>
        <Text style={[typography.bodyMedium, styles.nums, { color: colors.ink }]}>
          {option.title}
        </Text>
        <Text style={[typography.bodyMedium, styles.nums, { color: colors.ink }]}>
          {option.priceLabel}
        </Text>
      </View>
      {option.trialLabel !== null && (
        <Text style={[typography.caption, { color: colors.positive }]}>{option.trialLabel}</Text>
      )}
    </Pressable>
  );
}

/** The paywall with an injectable client (tests pass a fake). */
export function PaywallView({ client, apiKey }: PaywallViewProps) {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const { isPro } = useEntitlement();

  const [offer, setOffer] = useState<Offer>(() =>
    apiKey === null ? { state: 'unavailable' } : { state: 'loading' },
  );
  const [selected, setSelected] = useState<PaywallOption | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  // A ref as well as state: a second tap before the re-render must not buy twice.
  const busyRef = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    if (apiKey !== null) {
      client
        .getOfferings()
        .then((offerings) => {
          if (!mounted.current) return;
          const options = paywallOptions(offerings.current);
          setOffer(options.length === 0 ? { state: 'unavailable' } : { state: 'ready', options });
          setSelected(defaultOption(options));
        })
        .catch((e: unknown) => {
          console.warn('Loading the Pro offering failed.', e);
          if (mounted.current) setOffer({ state: 'unavailable' });
        });
    }
    return () => {
      mounted.current = false;
    };
  }, [client, apiKey]);

  /** Re-reads the entitlement; retries init if it failed at start-up. */
  async function syncEntitlement(): Promise<void> {
    const store = useProStore.getState();
    if (store.source === 'error') await store.init(client, { apiKey });
    else await store.refresh();
  }

  async function run(action: () => Promise<void>): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function show(next: Message): void {
    if (mounted.current) setMessage(next);
  }

  function onBuy(option: PaywallOption) {
    void run(async () => {
      try {
        await client.purchasePackage(option.pkg);
      } catch (e) {
        if (!isUserCancelled(e)) {
          console.warn('Purchase failed.', e);
          show({ text: PURCHASE_FAILED_MESSAGE, tone: 'alert' });
        }
        return;
      }
      await syncEntitlement();
      if (useProStore.getState().status !== 'pro') {
        show({ text: PURCHASE_PENDING_MESSAGE, tone: 'alert' });
      }
    });
  }

  function onRestore() {
    void run(async () => {
      let found: boolean;
      try {
        found = hasProEntitlement(await client.restorePurchases());
      } catch (e) {
        console.warn('Restore failed.', e);
        show({ text: RESTORE_FAILED_MESSAGE, tone: 'alert' });
        return;
      }
      await syncEntitlement();
      show(
        found
          ? { text: RESTORE_DONE_MESSAGE, tone: 'positive' }
          : { text: RESTORE_NONE_MESSAGE, tone: 'alert' },
      );
    });
  }

  const messageText = message !== null && (
    <Text
      accessibilityLiveRegion="polite"
      style={[typography.body, { color: colors[message.tone], marginBottom: spacing.lg }]}
    >
      {message.text}
    </Text>
  );

  const benefits = (
    <Card title="Pro includes">
      {PRO_BENEFITS.map((benefit) => (
        <Text key={benefit} style={[typography.body, { color: colors.ink, marginTop: spacing.xs }]}>
          {`• ${benefit}`}
        </Text>
      ))}
    </Card>
  );

  if (isPro) {
    return (
      <Screen
        title="You're Pro"
        scroll
        bottomInset
        footer={<Button label="Done" onPress={() => router.back()} />}
      >
        <Text style={[typography.body, { color: colors.ink, marginBottom: spacing.lg }]}>
          Thanks for supporting ShiftPay. Every Pro feature is unlocked.
        </Text>
        {messageText}
        {benefits}
        <View style={{ height: spacing.lg }} />
        <Disclaimer />
      </Screen>
    );
  }

  const ready = offer.state === 'ready';
  const footer = (
    <View style={[styles.row, { gap: spacing.md }]}>
      <View style={styles.fill}>
        <Button label="Back" variant="secondary" onPress={() => router.back()} />
      </View>
      {ready && selected !== null && (
        <View style={styles.fill}>
          <Button label={buyLabel(selected)} disabled={busy} onPress={() => onBuy(selected)} />
        </View>
      )}
    </View>
  );

  return (
    <Screen title="ShiftPay Pro" scroll bottomInset footer={footer}>
      {benefits}
      <View style={{ height: spacing.lg }} />

      {offer.state === 'loading' && (
        <Text style={[typography.body, { color: colors.inkMuted, marginBottom: spacing.lg }]}>
          Loading plans…
        </Text>
      )}
      {offer.state === 'unavailable' && (
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.body, { color: colors.inkMuted, marginBottom: spacing.lg }]}
        >
          {UNAVAILABLE_MESSAGE}
        </Text>
      )}
      {ready && (
        <View accessibilityRole="radiogroup" style={{ marginBottom: spacing.md }}>
          {offer.options.map((option) => (
            <PlanRow
              key={option.kind}
              option={option}
              selected={selected?.kind === option.kind}
              disabled={busy}
              onPress={() => setSelected(option)}
            />
          ))}
          <Text style={[typography.caption, { color: colors.inkMuted, marginTop: spacing.xs }]}>
            Subscriptions renew automatically until you cancel them in Google Play.
          </Text>
        </View>
      )}

      {messageText}

      {ready && (
        <View style={{ marginBottom: spacing.lg }}>
          <Button
            label="Restore purchases"
            variant="quiet"
            disabled={busy}
            onPress={onRestore}
          />
        </View>
      )}
      <Disclaimer />
    </Screen>
  );
}

export default function PaywallScreen() {
  return <PaywallView client={revenueCatClient} apiKey={revenueCatApiKey()} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  fill: { flex: 1 },
  plan: { minHeight: 48, justifyContent: 'center' },
  planRow: { flexDirection: 'row', justifyContent: 'space-between' },
  nums: { fontVariant: [...tabularNums] },
  pressed: { opacity: 0.8 },
});
