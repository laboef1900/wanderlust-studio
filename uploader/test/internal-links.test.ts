import { describe, expect, it } from 'vitest';
import { readInternalLinkCatalog, translationLinkMap } from '../src/internal-links.js';
import type { PostSummary } from '../src/posts.js';
import type { StoredPagePair } from '../src/pages.js';
import type { StoredJourney } from '../src/journeys.js';
import type { LanguageConfig } from '../src/language.js';

const BOTH: LanguageConfig = { primary: 'de', locales: ['de', 'en'] };
const EN: LanguageConfig = { primary: 'en', locales: ['en', 'de'] };
const DE_ONLY: LanguageConfig = { primary: 'de', locales: ['de'] };

function post(translationKey: string, published: Record<'de' | 'en', { slug: string; title: string; region: string } | null>): PostSummary {
  return {
    translationKey, title: published.de?.title ?? published.en?.title ?? '', slugs: { de: '', en: '' },
    status: published.de || published.en ? 'published' : 'draft', updatedAt: new Date(0),
    publication: { availability: 'available', status: 'published', requestedLocales: ['de', 'en'], committedLocales: ['de', 'en'], draftDiffers: false, live: { de: 'live', en: 'live' } },
    secondaryStatus: 'started', publishedLocales: published,
    heroSrc: '', heroWidth: 0, date: '', country: '', region: '', categories: [], tags: [], scheduledAt: null,
  };
}

function page(key: string, de: { title: string; slug: string; published: boolean }, en: { title: string; slug: string; published: boolean }): StoredPagePair {
  const content = (locale: 'de' | 'en', entry: { title: string; slug: string; published: boolean }) => ({
    locale, title: entry.title, bodyMarkdown: '', images: {}, slug: entry.slug,
    publishedAt: entry.published ? new Date(0) : null,
  });
  return { key, de: content('de', de), en: content('en', en), status: de.published || en.published ? 'published' : 'draft', updatedAt: new Date(0) };
}

function journey(): StoredJourney {
  return {
    id: 'j1', status: 'published',
    de: { slug: 'rundreise', title: 'Rundreise', intro: '', heroImage: null, omitted: false, publishedAt: new Date(0) },
    en: { slug: 'tour', title: 'Tour', intro: '', heroImage: null, omitted: true, publishedAt: new Date(0) },
    members: ['journey-member'],
    publishedSnapshot: {
      version: 1,
      members: ['journey-member', 'draft-member'],
      locales: {
        de: { slug: 'rundreise', title: 'Rundreise', intro: '', heroImage: null },
        en: { slug: 'tour', title: 'Tour', intro: '', heroImage: null },
      },
    } as unknown as StoredJourney['publishedSnapshot'],
    publishedAt: new Date(0), createdAt: new Date(0), updatedAt: new Date(0), hasUnpublishedChanges: false,
  };
}

const sources = {
  language: BOTH,
  posts: {
    list: async () => [
      post('member', { de: { slug: 'reise', title: 'Reise', region: 'europe' }, en: { slug: 'trip', title: 'Trip', region: 'europe' } }),
      post('secondary-draft', { de: { slug: 'entwurf', title: 'Entwurf', region: 'asia' }, en: null }),
      post('journey-member', { de: { slug: 'etappe', title: 'Etappe', region: 'europe' }, en: null }),
      post('empty-slug', { de: { slug: '', title: 'Ohne Slug', region: 'africa' }, en: null }),
    ],
  },
  pages: {
    getAll: async () => [
      page('about', { title: 'Über mich', slug: '', published: true }, { title: 'About', slug: '', published: true }),
      page('contact', { title: 'Kontakt', slug: 'kontakt', published: true }, { title: 'Contact', slug: 'contact', published: true }),
      page('privacy', { title: 'Datenschutz', slug: 'datenschutz', published: false }, { title: 'Privacy', slug: 'privacy', published: false }),
      page('legacy', { title: 'Legacy', slug: 'legacy', published: true }, { title: 'Legacy', slug: 'legacy', published: true }),
    ],
    keys: async () => [],
    get: async () => { throw new Error('unused'); },
  },
  journeys: { list: async () => [journey()] },
};

describe('internal link catalog', () => {
  it('returns one live target per path with a single server-built map', async () => {
    const catalog = await readInternalLinkCatalog(sources, 'de');
    const paths = catalog.targets.map((target) => target.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain('/');
    expect(paths).toContain('/uber-mich/');
    expect(paths).toContain('/kontakt/');
    expect(paths).toContain('/reise/');
    expect(paths).toContain('/rundreisen/');
    expect(paths).toContain('/rundreisen/rundreise/');
    expect(paths).toContain('/reiseziele/europa/');
    expect(paths).not.toContain('/datenschutz/');
    expect(paths).not.toContain('/legacy/');
    expect(paths).toContain('/entwurf/');
    expect(paths.filter((path) => path === '/uber-mich/')).toHaveLength(1);
    expect(catalog.links).toEqual(translationLinkMap(catalog));
    expect(catalog.links).toContainEqual({ from: '/', to: '/en/' });
    expect(catalog.links).toContainEqual({ from: '/uber-mich/', to: '/en/about-me/' });
    expect(catalog.links).toContainEqual({ from: '/reise/', to: '/en/trip/' });
    expect(catalog.links.find((link) => link.from === '/entwurf/')).toBeUndefined();
    expect(catalog.links.find((link) => link.from === '/rundreisen/rundreise/')).toBeUndefined();
    expect(catalog.links.find((link) => link.from === '/reiseziele/asien/')).toBeUndefined();
    expect(catalog.links).toContainEqual({ from: '/reiseziele/europa/', to: '/en/destinations/europe/' });
  });

  it('uses the explicit language mode for EN-primary roots and journeys', async () => {
    const catalog = await readInternalLinkCatalog({ ...sources, language: EN }, 'en');
    const paths = catalog.targets.map((target) => target.path);
    expect(paths).toContain('/');
    expect(paths).toContain('/travel-map/');
    expect(paths).not.toContain('/journeys/');
    expect(catalog.links).toContainEqual({ from: '/', to: '/de/' });
    expect(catalog.links).toContainEqual({ from: '/trip/', to: '/de/reise/' });
  });

  it('has no alternate paths or map on a single-locale install', async () => {
    const catalog = await readInternalLinkCatalog({ ...sources, language: DE_ONLY, journeys: undefined }, 'de');
    expect(catalog.alternateLocale).toBeNull();
    expect(catalog.links).toEqual([]);
    expect(catalog.targets.every((target) => target.alternatePath === null)).toBe(true);
  });
});
