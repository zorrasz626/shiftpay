import { StyleSheet, Text, View } from 'react-native';

export const DISCLAIMER =
  'Estimates only — not financial or tax advice. Always check with your employer/payroll.';

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>ShiftPay</Text>
      <Text style={styles.disclaimer}>{DISCLAIMER}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 32, fontWeight: '700', marginBottom: 12 },
  disclaimer: { fontSize: 14, textAlign: 'center' },
});
