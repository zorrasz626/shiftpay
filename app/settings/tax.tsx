/**
 * Tax settings (Pro): tax code, student loan plan(s) and workplace pension,
 * the inputs the net-pay estimate needs. Edits are local until Save, which
 * writes the whole profile as one `tax.profile` setting. Unsupported or
 * mistyped tax codes and bad percentages show an error and are not saved.
 * Free sees a Pro upsell instead of the form.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { Button } from '../../src/components/Button';
import { Chip } from '../../src/components/Chip';
import { Disclaimer } from '../../src/components/Disclaimer';
import { ProUpsell } from '../../src/components/ProUpsell';
import { Screen } from '../../src/components/Screen';
import { TextField } from '../../src/components/TextField';
import { db } from '../../src/db/client';
import { hasFeature } from '../../src/features/pro/gates';
import { useEntitlement } from '../../src/features/pro/useEntitlement';
import {
  PENSION_METHOD_LABELS,
  PENSION_METHODS,
  PENSION_PERCENT_MESSAGE,
  STUDENT_LOAN_LABELS,
  STUDENT_LOAN_OPTIONS,
  TAX_PROFILE_KEY,
  type TaxProfile,
  checkTaxCode,
  parsePensionPercent,
  readTaxProfile,
} from '../../src/features/tax/taxProfile';
import { useSettingsStore } from '../../src/store/settingsStore';
import { useTheme } from '../../src/theme/useTheme';

type TaxForm = Omit<TaxProfile, 'taxCode' | 'pensionPercent'> & {
  taxCodeText: string;
  pensionText: string;
};

function profileToForm(profile: TaxProfile): TaxForm {
  return {
    studentLoan: profile.studentLoan,
    postgrad: profile.postgrad,
    pensionMethod: profile.pensionMethod,
    taxCodeText: profile.taxCode,
    pensionText: String(profile.pensionPercent),
  };
}

export default function TaxSettingsScreen() {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const { isPro } = useEntitlement();
  const canEdit = hasFeature('netPay', isPro);
  const setSetting = useSettingsStore((s) => s.set);

  const [form, setForm] = useState(() =>
    profileToForm(readTaxProfile(useSettingsStore.getState().values)),
  );
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const taxCode = checkTaxCode(form.taxCodeText);
  const pensionPercent = parsePensionPercent(form.pensionText);
  const taxCodeError = submitted && 'error' in taxCode ? taxCode.error : undefined;
  const pensionError = submitted && pensionPercent === null ? PENSION_PERCENT_MESSAGE : undefined;

  async function onSave() {
    setSubmitted(true);
    if ('error' in taxCode || pensionPercent === null) return;
    const profile: TaxProfile = {
      taxCode: taxCode.code,
      studentLoan: form.studentLoan,
      postgrad: form.postgrad,
      pensionPercent,
      pensionMethod: form.pensionMethod,
    };
    setSaving(true);
    setSaveError(null);
    try {
      await setSetting(db, TAX_PROFILE_KEY, profile);
      router.back();
    } catch {
      setSaveError("Your changes couldn't be saved. Try again.");
      setSaving(false);
    }
  }

  const backButton = <Button label="Back" variant="secondary" onPress={() => router.back()} />;

  return (
    <Screen
      title="Tax & deductions"
      scroll
      bottomInset
      footer={
        canEdit ? (
          <View style={[styles.row, { gap: spacing.md }]}>
            <View style={styles.fill}>{backButton}</View>
            <View style={styles.fill}>
              <Button label="Save" disabled={saving} onPress={() => void onSave()} />
            </View>
          </View>
        ) : (
          backButton
        )
      }
    >
      {!canEdit ? (
        <View style={{ marginBottom: spacing.xl }}>
          <ProUpsell
            text="Net pay estimates"
            detail="Add your tax code, student loan and pension to estimate take-home pay."
          />
        </View>
      ) : (
        <>
          <TextField
            label="Tax code"
            value={form.taxCodeText}
            onChangeText={(t) => setForm((f) => ({ ...f, taxCodeText: t }))}
            placeholder="1257L"
            error={taxCodeError}
            helper="On your payslip or P45, e.g. 1257L"
          />

          <Text style={[typography.body, { color: colors.ink, marginBottom: spacing.sm }]}>
            Student loan
          </Text>
          <View style={[styles.wrap, { gap: spacing.md, marginBottom: spacing.lg }]}>
            {STUDENT_LOAN_OPTIONS.map((plan) => (
              <Chip
                key={plan}
                label={STUDENT_LOAN_LABELS[plan]}
                tone="neutral"
                selected={form.studentLoan === plan}
                onPress={() => setForm((f) => ({ ...f, studentLoan: plan }))}
              />
            ))}
          </View>

          <View style={[styles.row, styles.switchRow, { marginBottom: spacing.lg }]}>
            <Text style={[typography.body, styles.fill, { color: colors.ink }]}>
              Postgraduate loan
            </Text>
            <Switch
              accessibilityLabel="Postgraduate loan"
              value={form.postgrad}
              onValueChange={(v) => setForm((f) => ({ ...f, postgrad: v }))}
              trackColor={{ false: colors.line, true: colors.positive }}
            />
          </View>

          <TextField
            label="Pension contribution (%)"
            value={form.pensionText}
            onChangeText={(t) => setForm((f) => ({ ...f, pensionText: t }))}
            keyboardType="decimal-pad"
            placeholder="5"
            error={pensionError}
            helper="Your share, as a percentage of gross pay. 0 for none."
          />

          <Text style={[typography.body, { color: colors.ink, marginBottom: spacing.sm }]}>
            How your pension is taken
          </Text>
          <View style={[styles.wrap, { gap: spacing.md, marginBottom: spacing.xl }]}>
            {PENSION_METHODS.map((method) => (
              <Chip
                key={method}
                label={PENSION_METHOD_LABELS[method]}
                tone="neutral"
                selected={form.pensionMethod === method}
                onPress={() => setForm((f) => ({ ...f, pensionMethod: method }))}
              />
            ))}
          </View>

          {saveError !== null && (
            <Text
              accessibilityLiveRegion="polite"
              style={[typography.body, { color: colors.alert, marginBottom: spacing.lg }]}
            >
              {saveError}
            </Text>
          )}
        </>
      )}
      <Disclaimer />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  switchRow: { alignItems: 'center', minHeight: 48 },
  fill: { flex: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
