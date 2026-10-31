import { describe, expect, it } from 'vitest';
import { renderMsg, translate } from '../src';

describe('renderMsg', () => {
  it('injects vocabulary nouns and formats parameters', () => {
    const o = { locale: 'en' as const, vocabulary: 'clinic' as const, timezone: 'Asia/Kolkata' };
    expect(renderMsg({ key: 'fact.records_rate', params: { session: 'Laptop', count: 42, seconds: 120 } }, o)).toBe('Laptop requested 42 patient records in 120 seconds.');
    expect(renderMsg({ key: 'history.action_outcome', params: { action: 'records.pause_session', state: 'confirmed' } }, o)).toBe('Result of Pause records session: Action confirmed');
  });
  it('vocabulary switch changes labels only', () => {
    const a = renderMsg({ key: 'incident.title.former_staff', params: {} }, { locale: 'en', vocabulary: 'school', timezone: 'UTC' });
    const b = renderMsg({ key: 'incident.title.former_staff', params: {} }, { locale: 'en', vocabulary: 'shop', timezone: 'UTC' });
    expect(a).toContain('student records');
    expect(b).toContain('customer records');
  });
  it('falls back to the key rather than throwing for unknown keys', () => {
    expect(translate('does.not.exist', {}, { locale: 'en', vocabulary: 'generic', timezone: 'UTC' })).toBe('does.not.exist');
  });
  it('handles ICU plurals', () => {
    expect(translate('overview.summaryNeeds', { count: 0 }, { locale: 'en', vocabulary: 'generic', timezone: 'UTC' })).toBe('Nothing needs your decision right now.');
    expect(translate('overview.summaryNeeds', { count: 2 }, { locale: 'en', vocabulary: 'generic', timezone: 'UTC' })).toBe('2 concerns need your decision.');
  });
});
