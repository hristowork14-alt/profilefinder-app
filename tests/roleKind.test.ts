import { describe, expect, it } from 'vitest';
import { isSingleHolderRole } from '../shared/roleKind';

describe('isSingleHolderRole', () => {
  it('treats leadership roles as held by one person', () => {
    for (const position of [
      'CEO',
      'Chief Technology Officer',
      'CFO',
      'CISO',
      'CHRO',
      'Head of Design',
      'Head Engineer',
      'VP Engineering',
      'Vice President of Sales',
      'Managing Director',
      'General Manager',
      'Founder',
      'Co-Founder',
      'President',
      'Chairman',
      'Marketing Director',
      'Director of Engineering',
    ]) {
      expect(isSingleHolderRole(position), position).toBe(true);
    }
  });

  it('treats roles many people hold at once as not single', () => {
    for (const position of [
      'Engineer',
      'Electrical Engineer',
      'Aerospace Engineer',
      'Software Developer',
      'Data Analyst',
      'Recruiter',
      'Account Executive',
      'Marketing Manager',
      'Purchase Ledger Manager',
      'Designer',
      'HR',
      'Sales Representative',
    ]) {
      expect(isSingleHolderRole(position), position).toBe(false);
    }
  });
});
