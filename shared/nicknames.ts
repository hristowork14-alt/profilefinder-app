// Common English first-name forms, so "Andy Jassy" in a news article matches a LinkedIn profile
// titled "Andrew Jassy" (and the other way round). Each group lists forms of the same name. Kept
// small and general on purpose: it covers the frequent cases, and namesMatch still requires the
// same last name.

const GROUPS: string[][] = [
  ['andrew', 'andy', 'drew'],
  ['william', 'bill', 'will', 'billy', 'liam'],
  ['robert', 'bob', 'rob', 'bobby', 'robbie'],
  ['richard', 'rick', 'rich', 'dick', 'ricky'],
  ['michael', 'mike', 'mick', 'mikey'],
  ['james', 'jim', 'jimmy', 'jamie'],
  ['john', 'jack', 'johnny', 'jon'],
  ['joseph', 'joe', 'joey'],
  ['thomas', 'tom', 'tommy'],
  ['charles', 'charlie', 'chuck', 'chas'],
  ['christopher', 'chris', 'kit'],
  ['daniel', 'dan', 'danny'],
  ['david', 'dave', 'davey'],
  ['edward', 'ed', 'eddie', 'ted', 'ned'],
  ['steven', 'stephen', 'steve'],
  ['anthony', 'tony'],
  ['matthew', 'matt'],
  ['nicholas', 'nick', 'nicky'],
  ['benjamin', 'ben', 'benny'],
  ['samuel', 'sam', 'sammy'],
  ['alexander', 'alex', 'sasha', 'xander'],
  ['jonathan', 'jon', 'jonny'],
  ['timothy', 'tim', 'timmy'],
  ['patrick', 'pat', 'paddy'],
  ['peter', 'pete'],
  ['gregory', 'greg'],
  ['jeffrey', 'geoffrey', 'jeff', 'geoff'],
  ['kenneth', 'ken', 'kenny'],
  ['ronald', 'ron', 'ronnie'],
  ['donald', 'don', 'donnie'],
  ['lawrence', 'laurence', 'larry'],
  ['frederick', 'fred', 'freddie'],
  ['philip', 'phillip', 'phil'],
  ['raymond', 'ray'],
  ['gerald', 'gerry', 'jerry'],
  ['douglas', 'doug'],
  ['zachary', 'zach', 'zack'],
  ['elizabeth', 'liz', 'beth', 'betty', 'eliza', 'lizzie'],
  ['katherine', 'catherine', 'kathryn', 'kate', 'katie', 'kathy', 'cathy', 'kat'],
  ['margaret', 'maggie', 'meg', 'peggy'],
  ['jennifer', 'jen', 'jenny'],
  ['rebecca', 'becky', 'becca'],
  ['susan', 'sue', 'susie', 'suzanne'],
  ['patricia', 'pat', 'patty', 'trish'],
  ['victoria', 'vicky', 'tori'],
  ['christina', 'christine', 'chris', 'tina'],
  ['jessica', 'jess', 'jessie'],
  ['elinor', 'eleanor', 'ellie', 'nora', 'elle'],
  ['deborah', 'debra', 'deb', 'debbie'],
  ['samantha', 'sam', 'sammie'],
  ['alexandra', 'alex', 'sasha', 'lexi'],
  ['abigail', 'abby'],
  ['kimberly', 'kim'],
  ['pamela', 'pam'],
  ['cynthia', 'cindy'],
];

const BY_NAME = new Map<string, Set<string>>();
for (const group of GROUPS) {
  for (const name of group) {
    const set = BY_NAME.get(name) ?? new Set<string>();
    for (const other of group) if (other !== name) set.add(other);
    BY_NAME.set(name, set);
  }
}

/** True when two (lowercase, accent-free) first names are forms of the same name. */
export function sameFirstName(a: string, b: string): boolean {
  return a === b || (BY_NAME.get(a)?.has(b) ?? false);
}

/**
 * The forms worth searching for, most useful first: a nickname maps to its full name(s)
 * ("andy" → ["andrew"]); a full name maps to its nicknames ("william" → ["bill", "will", …]).
 */
export function otherFirstNames(first: string): string[] {
  const formal = GROUPS.filter((g) => g.indexOf(first) > 0).map((g) => g[0]!);
  if (formal.length > 0) return [...new Set(formal)];
  return GROUPS.filter((g) => g[0] === first).flatMap((g) => g.slice(1));
}
