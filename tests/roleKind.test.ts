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

describe('topRoleTitles', () => {
  it('names the top role of the function a "Head of" / Director / VP position leads', async () => {
    const { topRoleTitles } = await import('../shared/roleKind');
    expect(topRoleTitles('Head of Design', ['Design Director', 'VP Design'])).toEqual(['Chief Design Officer']);
    expect(topRoleTitles('Head of Engineering', ['CTO', 'Chief Technology Officer', 'VP Engineering'])).toEqual([
      'Chief Technology Officer',
      'Chief Engineering Officer',
    ]);
    expect(topRoleTitles('Marketing Director', [])).toEqual(['Chief Marketing Officer']);
    expect(topRoleTitles('VP of People', [])).toEqual(['Chief People Officer']);
    expect(topRoleTitles('CEO', [])).toEqual([]);
    expect(topRoleTitles('Mechanical Engineer', [])).toEqual([]);
  });
});
