import { describe, expect, it } from 'vitest';
import type { ExportRow } from '../src/lib/csv';
import { STATUS_ORDER, rowStatus, statusCounts, statusInfo } from '../src/lib/resultStatus';

const profile = (verified: boolean) => ({
  fullName: 'Andy Corwin',
  headline: 'CEO at Orbitly',
  linkedinUrl: 'https://www.linkedin.com/in/andycorwin',
  confidence: 80,
  reasoning: 'r',
  verified,
});
const holder = { name: 'Andy Corwin', sources: 2, sourceLinks: [] };
const base: ExportRow = { companyUrl: 'orbitly.com', position: 'CEO', companyName: 'Orbitly', results: [], status: 'completed' };

describe('rowStatus', () => {
  it('gives every kind of row one clear status', () => {
    expect(rowStatus({ ...base, results: [profile(true)], verifiedHolder: holder, decision: 'verified_profile' })).toBe('verified');
    expect(rowStatus({ ...base, verifiedHolder: holder, decision: 'verified_no_profile' })).toBe('verified_no_profile');
    expect(rowStatus({ ...base, results: [profile(false)], verifiedHolder: null, decision: 'contradicted' })).toBe('conflict');
    expect(rowStatus({ ...base, results: [profile(false)], verifiedHolder: null, decision: 'unverified' })).toBe('possible');
    expect(rowStatus({ ...base, position: 'Electrical Engineer', results: [profile(false)], verifiedHolder: null })).toBe('many');
    expect(rowStatus({ ...base, verifiedHolder: null, decision: 'no_results' })).toBe('not_found');
    expect(rowStatus({ ...base, status: 'failed', error: 'Search failed.' })).toBe('failed');
    expect(rowStatus({ ...base, status: 'pending' })).toBe('pending');
  });

  it('handles searches from before the outcome was stored, and the demo (no verification)', () => {
    expect(rowStatus({ ...base, results: [profile(true)], verifiedHolder: holder })).toBe('verified');
    expect(rowStatus({ ...base, verifiedHolder: holder })).toBe('verified_no_profile');
    expect(rowStatus({ ...base, results: [profile(false)], verifiedHolder: null })).toBe('possible');
    expect(rowStatus({ ...base, results: [profile(false)] })).toBe('match');
  });
});

describe('statusInfo', () => {
  it('has a short label, a meaning and a group for every status', () => {
    for (const key of STATUS_ORDER) {
      const info = statusInfo(key);
      expect(info.label.length).toBeGreaterThan(3);
      expect(info.meaning.length).toBeGreaterThan(20);
      expect(['found', 'review', 'none']).toContain(info.group);
    }
    expect(statusInfo('conflict').group).toBe('review');
    expect(statusInfo('verified').group).toBe('found');
    expect(statusInfo('failed').group).toBe('none');
  });
});

describe('statusCounts', () => {
  it('counts rows per status in a fixed order', () => {
    const counts = statusCounts([
      { ...base, verifiedHolder: holder },
      { ...base, verifiedHolder: holder },
      { ...base, status: 'failed' },
    ]);
    expect(counts.find((c) => c.key === 'verified_no_profile')?.count).toBe(2);
    expect(counts.find((c) => c.key === 'failed')?.count).toBe(1);
    expect(counts.every((c) => c.count > 0)).toBe(true);
  });
});

describe('rowStatus: outcomes added for the search widening (2026-10-28)', () => {
  it('maps every new outcome to its own status', () => {
    expect(rowStatus({ ...base, results: [profile(true)], verifiedHolder: holder, decision: 'verified_elsewhere' })).toBe(
      'verified_elsewhere',
    );
    expect(rowStatus({ ...base, results: [profile(false)], verifiedHolder: holder, decision: 'verified_name_match' })).toBe(
      'verified_name_match',
    );
    expect(rowStatus({ ...base, verifiedHolder: holder, decision: 'likely' })).toBe('likely');
    expect(rowStatus({ ...base, results: [profile(false)], verifiedHolder: holder, decision: 'likely' })).toBe('likely');
    expect(
      rowStatus({ ...base, position: 'Mechanical Engineer', results: [profile(false)], verifiedHolder: null, decision: 'closest' }),
    ).toBe('closest');
  });

  it('labels them in plain words', () => {
    expect(statusInfo('verified_elsewhere').label).toBe('Verified — also works elsewhere');
    expect(statusInfo('verified_name_match').label).toBe('Verified — profile matched by name only');
    expect(statusInfo('likely').label).toBe('Likely — 1 source');
    expect(statusInfo('closest').label).toBe('Closest matches');
    expect(statusInfo('verified_elsewhere').group).toBe('found');
    for (const key of ['verified_name_match', 'likely', 'closest'] as const) expect(statusInfo(key).group).toBe('review');
  });
});
