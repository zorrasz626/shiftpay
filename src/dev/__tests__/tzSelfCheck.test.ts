import * as time from '../../engine/time';
import { tzSelfCheck } from '../tzSelfCheck';

describe('tzSelfCheck', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('passes in Jest (process TZ is not London)', () => {
    expect(tzSelfCheck()).toEqual({ ok: true, failures: [] });
  });

  it('reports a wrong offset', () => {
    jest.spyOn(time, 'utcOffsetMinutes').mockReturnValue(0);
    const result = tzSelfCheck();
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      'BST offset 2026-07-01T12:00Z: expected 60, got 0',
    ]);
  });

  it('reports a throwing conversion', () => {
    jest.spyOn(time, 'instantToLocal').mockImplementation(() => {
      throw new Error('no Intl');
    });
    const result = tzSelfCheck();
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(3);
    expect(result.failures[0]).toContain('threw no Intl');
  });
});
