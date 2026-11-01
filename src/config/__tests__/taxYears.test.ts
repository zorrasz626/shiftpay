import { TAX_YEARS } from '../taxYears';

describe('TAX_YEARS', () => {
  it('has at least one year', () => {
    expect(TAX_YEARS.length).toBeGreaterThan(0);
  });

  it.each(TAX_YEARS.map((y) => [y.id, y] as const))('%s is well formed', (id, year) => {
    expect(id).toMatch(/^\d{4}\/\d{2}$/);
    expect(year.startsOn).toBe(`${id.slice(0, 4)}-04-06`);
    expect(Number.isInteger(year.personalAllowancePence)).toBe(true);
    for (const region of Object.values(year.incomeTax)) {
      const limits = region.bands.map((b) => b.upToPence);
      expect(limits[limits.length - 1]).toBeNull();
      const finite = limits.slice(0, -1) as number[];
      expect(finite.every((n) => Number.isInteger(n))).toBe(true);
      expect([...finite].sort((a, b) => a - b)).toEqual(finite);
    }
  });
});
