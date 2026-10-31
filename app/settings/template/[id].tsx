/**
 * Shift type editor: one shift template (name, start, end, unpaid break).
 * `id` is a template id, or 'new'. Edits are local until Save, which replaces
 * the whole template and moves future rota shifts to the new times; Back
 * discards them. Delete asks first, and is refused while the rota uses it.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../../../src/components/Button';
import { Disclaimer } from '../../../src/components/Disclaimer';
import { Screen } from '../../../src/components/Screen';
import { TextField } from '../../../src/components/TextField';
import { db } from '../../../src/db/client';
import type { StoredShiftTemplate } from '../../../src/db/rotaRepo';
import {
  type TemplateFormField,
  type TemplateFormValues,
  formToTemplate,
  newTemplateForm,
  templateFormErrors,
  templateToForm,
} from '../../../src/engine/rotaForm';
import { instantToLocal } from '../../../src/engine/time';
import { useJobsStore } from '../../../src/store/jobsStore';
import { endsNextDay, newId } from '../../../src/store/onboardingStore';
import { TemplateInUseError, useRotaStore } from '../../../src/store/rotaStore';
import { useTheme } from '../../../src/theme/useTheme';

export const TEMPLATE_IN_USE_MESSAGE =
  'This shift type is used in your rota. Change those days first.';

function TemplateForm({
  initial,
  templateId,
  jobId,
  colour,
  isNew,
}: {
  initial: TemplateFormValues;
  templateId: string;
  jobId: string;
  colour: string | undefined;
  isNew: boolean;
}) {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const saveTemplate = useRotaStore((s) => s.saveTemplate);
  const removeTemplate = useRotaStore((s) => s.removeTemplate);

  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const errors = templateFormErrors(values);
  const errorFor = (field: TemplateFormField) => errors.find((e) => e.field === field)?.message;
  const valid = errors.length === 0;
  const set = (patch: Partial<TemplateFormValues>) => setValues((v) => ({ ...v, ...patch }));

  async function run(action: (today: string) => Promise<void>, failure: string) {
    setBusy(true);
    setSaveError(null);
    try {
      await action(instantToLocal(new Date().toISOString()).date);
      router.back();
    } catch (e) {
      setSaveError(e instanceof TemplateInUseError ? TEMPLATE_IN_USE_MESSAGE : failure);
      setConfirmDelete(false);
      setBusy(false);
    }
  }

  const onSave = () =>
    run((today) => {
      const template: StoredShiftTemplate = formToTemplate(values, { id: templateId, jobId });
      return saveTemplate(db, colour === undefined ? template : { ...template, colour }, today);
    }, "Your changes couldn't be saved. Try again.");
  const onDelete = () =>
    run(
      (today) => removeTemplate(db, templateId, today),
      "The shift type couldn't be deleted. Try again.",
    );

  const endHelper =
    values.startTime === values.endTime
      ? 'Same start and end time: a 24-hour shift.'
      : endsNextDay(values.startTime, values.endTime)
        ? 'Ends next day'
        : '24-hour clock, for example 07:00 or 19:00';

  return (
    <Screen
      title={isNew ? 'Add shift type' : 'Edit shift type'}
      scroll
      bottomInset
      footer={
        <View style={[styles.row, { gap: spacing.md }]}>
          <View style={styles.fill}>
            <Button label="Back" variant="secondary" onPress={() => router.back()} />
          </View>
          <View style={styles.fill}>
            <Button label="Save" disabled={!valid || busy} onPress={onSave} />
          </View>
        </View>
      }
    >
      <TextField
        label="Name"
        value={values.name}
        onChangeText={(name) => set({ name })}
        placeholder="Early"
        error={errorFor('name')}
      />
      <TextField
        label="Starts (HH:MM)"
        value={values.startTime}
        onChangeText={(startTime) => set({ startTime })}
        keyboardType="numbers-and-punctuation"
        placeholder="07:00"
        error={errorFor('startTime')}
      />
      <TextField
        label="Ends (HH:MM)"
        value={values.endTime}
        onChangeText={(endTime) => set({ endTime })}
        keyboardType="numbers-and-punctuation"
        placeholder="19:00"
        error={errorFor('endTime')}
        helper={endHelper}
      />
      <TextField
        label="Unpaid break (minutes)"
        value={values.breakText}
        onChangeText={(breakText) => set({ breakText })}
        keyboardType="number-pad"
        placeholder="30"
        error={errorFor('breakText')}
        helper="Use 0 if your breaks are paid"
      />

      {!isNew &&
        (confirmDelete ? (
          <View style={{ gap: spacing.sm, marginBottom: spacing.xl }}>
            <Text style={[typography.body, { color: colors.ink }]}>Delete this shift type?</Text>
            <View style={[styles.row, { gap: spacing.md }]}>
              <View style={styles.fill}>
                <Button
                  label="Cancel"
                  variant="secondary"
                  onPress={() => setConfirmDelete(false)}
                />
              </View>
              <View style={styles.fill}>
                <Button label="Delete" disabled={busy} onPress={onDelete} />
              </View>
            </View>
          </View>
        ) : (
          <View style={{ marginBottom: spacing.xl }}>
            <Button
              label="Delete shift type"
              variant="quiet"
              onPress={() => setConfirmDelete(true)}
            />
          </View>
        ))}

      {saveError !== null && (
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.body, { color: colors.alert, marginBottom: spacing.lg }]}
        >
          {saveError}
        </Text>
      )}
      <Disclaimer />
    </Screen>
  );
}

export default function TemplateEditorScreen() {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const job = useJobsStore((s) => s.jobs[0]);
  const template = useRotaStore((s) => s.templates.find((t) => t.id === id));
  const [newTemplateId] = useState(() => newId('tpl'));

  if (job !== undefined && id === 'new') {
    return (
      <TemplateForm
        initial={newTemplateForm()}
        templateId={newTemplateId}
        jobId={job.id}
        colour={undefined}
        isNew
      />
    );
  }
  if (template !== undefined) {
    return (
      <TemplateForm
        key={template.id}
        initial={templateToForm(template)}
        templateId={template.id}
        jobId={template.jobId}
        colour={template.colour}
        isNew={false}
      />
    );
  }
  return (
    <Screen
      title="Shift type not found"
      bottomInset
      footer={<Button label="Back" variant="secondary" onPress={() => router.back()} />}
    >
      <Text style={[typography.body, { color: colors.ink, marginBottom: spacing.lg }]}>
        This shift type may have been deleted.
      </Text>
      <Disclaimer />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  fill: { flex: 1 },
});
