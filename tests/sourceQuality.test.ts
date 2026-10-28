import { describe, expect, it } from 'vitest';
import {
  cleanSourceUrl,
  isJobPage,
  isWeakSource,
  mentionsCompany,
  siteOf,
  sourceTier,
  summarizeSupport,
  type SupportPage,
} from '../shared/sourceQuality';
import type { RankingContext } from '../shared/types';

const ctx: RankingContext = { companyName: 'Northwind', domain: 'northwind.com', position: 'CTO', synonyms: ['Chief Technology Officer'] };

describe('siteOf', () => {
  it('reduces a host to the site it belongs to, so one website counts once', () => {
    expect(siteOf('ir.northwind.com')).toBe('northwind.com');
    expect(siteOf('www.news.example')).toBe('news.example');
    expect(siteOf('blog.shop.co.uk')).toBe('shop.co.uk');
    expect(siteOf('en.wikipedia.org')).toBe('wikipedia.org');
  });

  it('keeps blogs on shared hosting platforms apart (each is its own author)', () => {
    expect(siteOf('alice.substack.com')).toBe('alice.substack.com');
    expect(siteOf('bob.github.io')).toBe('bob.github.io');
  });
});

describe('cleanSourceUrl', () => {
  it('removes tracking parameters and fragments, keeping the real address', () => {
    expect(cleanSourceUrl('https://www.northwind.com/about?srsltid=AYCX9vJ8&utm_source=x#team')).toBe('https://www.northwind.com/about');
    expect(cleanSourceUrl('https://news.example/a?id=7&gclid=1')).toBe('https://news.example/a?id=7');
  });

  it('leaves unparseable addresses alone', () => {
    expect(cleanSourceUrl('not a url')).toBe('not a url');
  });
});

describe('isJobPage', () => {
  it('recognises job ads and careers pages', () => {
    expect(isJobPage('https://www.northwind.com/careers/search/job/electrical-engineer-12345', 'Electrical Engineer')).toBe(true);
    expect(isJobPage('https://boards.greenhouse.io/northwind/jobs/1', 'Senior CTO Office Lead')).toBe(true);
    expect(isJobPage('https://news.example/northwind-cto', 'Northwind names CTO')).toBe(false);
  });
});

describe('isWeakSource', () => {
  it('treats social networks, video, podcasts, forums and contact-data sites as weak', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=abc',
      'https://www.facebook.com/groups/1/posts/2/',
      'https://www.instagram.com/reel/x/',
      'https://www.reddit.com/r/x/comments/1/',
      'https://open.spotify.com/episode/1',
      'https://sellercentral.example/seller-forums/discussions/t/1',
      'https://rocketreach.co/mara-velin-email_1',
    ]) {
      expect(isWeakSource(url, 'Some page'), url).toBe(true);
    }
    expect(isWeakSource('https://contacts.example/p/1', 'Mara Velin Email & Phone Number | Northwind CTO')).toBe(true);
  });

  it('keeps news, encyclopedias and company sites as normal sources', () => {
    expect(isWeakSource('https://www.reuters.com/business/x', 'Northwind CTO')).toBe(false);
    expect(isWeakSource('https://en.wikipedia.org/wiki/Northwind', 'Northwind')).toBe(false);
    expect(isWeakSource('https://www.northwind.com/leadership', 'Leadership')).toBe(false);
  });
});

describe('sourceTier', () => {
  it('ranks the company site first, then normal sources, then weak ones', () => {
    expect(sourceTier('https://ir.northwind.com/team', 'Team', ctx.domain)).toBe('official');
    expect(sourceTier('https://news.example/a', 'Northwind CTO', ctx.domain)).toBe('strong');
    expect(sourceTier('https://www.youtube.com/watch?v=1', 'Northwind CTO', ctx.domain)).toBe('weak');
  });
});

describe('mentionsCompany', () => {
  it('needs the company name, its website or its domain label', () => {
    expect(mentionsCompany('Mara Velin, CTO of Northwind', ctx)).toBe(true);
    expect(mentionsCompany('see northwind.com/team', ctx)).toBe(true);
    expect(mentionsCompany('Mara Velin, CTO of Quillstone', ctx)).toBe(false);
  });

  it('does not match the name inside a longer word', () => {
    expect(mentionsCompany('Northwindows Ltd appoints CTO', ctx)).toBe(false);
  });
});

describe('summarizeSupport', () => {
  const page = (url: string, quote = 'Mara Velin, CTO of Northwind'): SupportPage => ({ url, title: 'Page', quote });

  it('counts each website once, the company site double, and lists one link per site', () => {
    const support = summarizeSupport(
      [
        page('https://ir.northwind.com/a'),
        page('https://www.northwind.com/b'),
        page('https://news.example/1'),
        page('https://news.example/2'),
      ],
      ctx.domain,
    );
    expect(support).toMatchObject({ score: 3, sites: 2, strongSites: 2 });
    expect(support.links.map((l) => l.url)).toEqual(['https://ir.northwind.com/a', 'https://news.example/1']);
  });

  it('lets weak sources add at most one point and never stand alone', () => {
    const weakOnly = summarizeSupport(
      [page('https://www.youtube.com/watch?v=1'), page('https://www.reddit.com/r/a/1'), page('https://open.spotify.com/episode/1')],
      ctx.domain,
    );
    expect(weakOnly).toMatchObject({ score: 1, strongSites: 0 });

    const mixed = summarizeSupport([page('https://news.example/1'), page('https://www.youtube.com/watch?v=1')], ctx.domain);
    expect(mixed).toMatchObject({ score: 2, sites: 2, strongSites: 1 });
  });

  it('shows stronger sources before weak ones and keeps a short quote with every link', () => {
    const support = summarizeSupport(
      [page('https://www.youtube.com/watch?v=1'), page('https://news.example/1'), page('https://ir.northwind.com/team')],
      ctx.domain,
    );
    expect(support.links.map((l) => l.url)).toEqual(['https://ir.northwind.com/team', 'https://news.example/1']);
    expect(support.links[0]?.quote).toBe('Mara Velin, CTO of Northwind');
  });

  it('cleans tracking parameters from the links it returns', () => {
    const support = summarizeSupport([page('https://news.example/1?srsltid=abc'), page('https://other.example/2')], ctx.domain);
    expect(support.links[0]?.url).toBe('https://news.example/1');
  });
});
