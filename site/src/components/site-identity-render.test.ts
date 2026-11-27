import { Window } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import AboutPage from './pages/AboutPage.astro';
import HomePage from './pages/HomePage.astro';
import RegionPage from './pages/RegionPage.astro';
import FeaturedHero from './FeaturedHero.astro';
import { identity } from '../lib/build-identity';
import { neutralIdentity, parseIdentitySnapshot, toIdentitySnapshot } from '../lib/site-identity';
import { ABOUT_PORTRAIT_SIZES } from '../lib/body-images';
import type { SiteLanguage } from '../lib/site-language';
import { blogPostingJsonLd } from '../lib/seo';
import { GET as feed } from '../pages/[...locale]/rss.xml';
import type { Locale } from '../i18n/ui';
import type { Trip } from '../lib/trips';

vi.mock('astro:content', () => ({
  getCollection: async () => [], getEntry: async () => undefined,
}));

const legacy = {
  siteName: "Simon's Wanderlust", authorName: 'Simon',
  tagline: { de: 'Reiseabenteuer & Geschichten', en: 'Travel adventures & stories' },
  aboutRole: { de: 'Reisender & Autor', en: 'Traveler & Storyteller' },
  aboutGear: { de: 'Leica Q2 · analoge Canon AE-1 · Notizbuch', en: 'Leica Q2 · analog Canon AE-1 · notebook' },
  socialLinks: [{ label: 'Instagram', url: 'https://www.instagram.com/simonswanderlust' }],
};
const windows: Window[] = [];
beforeEach(() => { Object.assign(identity, parseIdentitySnapshot(undefined)); });
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(windows.splice(0).map((window) => window.happyDOM.close()));
});

function documentOf(html: string) {
  const window = new Window();
  windows.push(window);
  return new window.DOMParser().parseFromString(html, 'text/html');
}
function feedDocument(xml: string) {
  const window = new Window();
  windows.push(window);
  return new window.DOMParser().parseFromString(xml, 'application/xml');
}
async function aboutHtml(locale: Locale) {
  const container = await AstroContainer.create();
  return container.renderToString(AboutPage, {
    props: { locale }, request: new Request('https://example.com/about/'),
  });
}
async function about(locale: Locale) {
  return documentOf(await aboutHtml(locale));
}

const story = {
  title: 'A journey', date: new Date(2024, 9, 3), excerpt: 'A story.', locale: 'en' as const,
  image: { src: 'https://img.example.com/hero', width: 1600, height: 900, alt: 'Landscape' },
  url: 'https://example.com/a-journey/',
};

describe('About portrait plate', () => {
  const modes: SiteLanguage[] = [
    { primary: 'de', locales: ['de', 'en'] }, { primary: 'en', locales: ['en', 'de'] },
    { primary: 'de', locales: ['de'] }, { primary: 'en', locales: ['en'] },
  ];
  const image = { src: 'https://restored.example/photos/author', width: 1600, height: 2000,
    alt: 'Author"><img src=x onerror=alert(1)>', focus: { x: 65, y: 25 } };

  it.each(modes)('keeps the original compass bytes for each enabled locale in $primary / $locales', async mode => {
    vi.stubEnv('SITE_LANGUAGE_JSON', JSON.stringify(mode));
    // Captured from the pre-portrait profile with author A and role B.
    const compassHeader = '<div class="flex items-center gap-4"> <div class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-navy text-white shadow-md"> '
      + '<svg aria-hidden="true" focusable="false" class="h-7 w-7 text-brand-red-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"> '
      + '<circle cx="12" cy="12" r="10"></circle> <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon> </svg> </div> '
      + '<div class="min-w-0"> <h2 class="text-xl font-extrabold text-navy">A</h2> <p class="font-mono text-xs font-semibold tracking-widest text-brand-red uppercase"> B </p> </div> </div>';
    for (const locale of mode.locales) {
      const saved = { ...neutralIdentity(), authorName: 'A', aboutRole: { [locale]: 'B' } };
      Object.assign(identity, toIdentitySnapshot(saved, mode.locales));
      const original = await aboutHtml(locale);
      expect(original.replace(/ data-astro-source-(?:file|loc)="[^"]*"/g, '')).toContain(compassHeader);
      const other = locale === 'de' ? 'en' : 'de';
      Object.assign(identity, toIdentitySnapshot({ ...saved, aboutPortrait: { [other]: image } }, mode.locales));
      expect(await aboutHtml(locale)).toBe(original);
    }
  });

  it.each(['de', 'en'] as const)('renders only the %s portrait with safe alt and retargeted variants', async locale => {
    vi.stubEnv('PUBLIC_BASE_URL', 'https://media.example');
    const german = { ...image, src: 'https://old.example/photos/de', alt: 'Deutsches Porträt', format: 'jpeg' as const };
    const saved = { ...neutralIdentity(), ...legacy, aboutPortrait: { de: german, en: image } };
    Object.assign(identity, parseIdentitySnapshot(JSON.stringify(toIdentitySnapshot(saved))));
    const doc = await about(locale);
    const card = doc.querySelector('main h2')!.parentElement!.parentElement!.parentElement!;
    const img = card.querySelector('picture img')!;
    const entry = saved.aboutPortrait[locale];
    const base = 'https://media.example' + new URL(entry.src).pathname;
    expect(img.getAttribute('src')).toBe(`${base}-1280.${locale === 'de' ? 'jpeg' : 'webp'}`);
    expect(img.getAttribute('alt')).toBe(entry.alt);
    expect(img.getAttribute('width')).toBe('1600');
    expect(img.getAttribute('height')).toBe('2000');
    expect(img.getAttribute('style')).toContain('object-position:65% 25%');
    expect(img.getAttribute('loading')).toBe('eager');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(card.querySelector('svg, [onerror]')).toBeNull();
    expect(card.querySelectorAll('img')).toHaveLength(1);
    const sources = [...card.querySelectorAll('picture source')];
    expect(sources.map(source => source.getAttribute('type'))).toEqual(locale === 'de' ? ['image/jpeg'] : ['image/avif', 'image/webp']);
    for (const source of sources) {
      const format = source.getAttribute('type')!.split('/')[1];
      expect(source.getAttribute('sizes')).toBe(ABOUT_PORTRAIT_SIZES);
      expect(source.getAttribute('srcset')).toBe([640, 1280, 1600].map(w => `${base}-${w}.${format} ${w}w`).join(', '));
    }
    expect(card.textContent).toContain(legacy.aboutGear[locale]);
  });
});

describe('configured identity rendered at public escaping boundaries', () => {
  it.each(['de', 'en'] as const)('keeps legal links independent of configured social profiles in %s', async (locale) => {
    for (const socialLinks of [[], legacy.socialLinks, [...legacy.socialLinks, { label: 'Notes', url: 'https://notes.example/' }]]) {
      Object.assign(identity, { socialLinks });
      const document = await about(locale);
      expect(document.querySelectorAll(`footer a[href="/legal/${locale}.html"]`)).toHaveLength(1);
      expect(document.querySelectorAll('footer a[href="/legal/THIRD-PARTY-NOTICES.txt"]')).toHaveLength(1);
      expect(document.querySelectorAll('footer a[target="_blank"]')).toHaveLength(socialLinks.length);
    }
  });

  it.each(['de', 'en'] as const)('preserves the legacy title, metadata, About profile, footer and RSS in %s', async (locale) => {
    Object.assign(identity, legacy);
    const document = await about(locale);
    expect(document.title).toBe((locale === 'de' ? 'Über mich' : 'About me') + " – Simon's Wanderlust");
    expect(document.querySelector('meta[property="og:site_name"]')?.getAttribute('content')).toBe("Simon's Wanderlust");
    expect(document.querySelector('link[type="application/rss+xml"]')?.getAttribute('title')).toBe("Simon's Wanderlust");
    expect(document.querySelector('header a')?.textContent?.trim()).toBe("Simon's Wanderlust");
    expect(document.querySelector('main h2')?.textContent).toBe('Simon');
    expect(document.querySelector('main')?.textContent).toContain(legacy.aboutRole[locale]);
    expect(document.querySelector('main')?.textContent).toContain(legacy.aboutGear[locale]);
    expect(document.querySelector('footer')?.textContent).toContain(legacy.tagline[locale]);
    expect(document.querySelector('footer')?.textContent).toContain(legacy.aboutGear[locale]);
    const social = document.querySelector('footer a[target="_blank"]');
    expect(social?.textContent).toBe('Instagram ↗');
    expect(social?.getAttribute('href')).toBe(legacy.socialLinks[0]!.url);
    expect(social?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(blogPostingJsonLd(story).author).toEqual({ '@type': 'Person', name: 'Simon' });
    const response = await feed({ site: new URL('https://example.com'), currentLocale: locale });
    const xml = feedDocument(await response.text());
    expect(xml.querySelector('channel > title')?.textContent).toBe("Simon's Wanderlust");
    expect(xml.querySelector('channel > description')?.textContent).toBe(legacy.tagline[locale]);
  });

  it.each(['de', 'en'] as const)('uses neutral fallbacks and omits empty optional profile details in %s', async (locale) => {
    const document = await about(locale);
    const fallback = locale === 'de' ? 'Reisejournal' : 'Travel journal';
    expect(document.querySelector('meta[property="og:site_name"]')?.getAttribute('content')).toBe(fallback);
    expect(document.querySelector('main h2')).toBeNull();
    expect(document.querySelector('main')?.textContent).not.toContain(locale === 'de' ? 'Ausrüstung' : 'Equipment');
    expect(document.querySelectorAll('footer a[target="_blank"]')).toHaveLength(0);
    expect(blogPostingJsonLd(story)).not.toHaveProperty('author');
  });

  it('escapes hostile names, profile text, social labels and RSS while preserving link order', async () => {
    const hostile = '</script><img src=x onerror=alert(1)>';
    Object.assign(identity, {
      siteName: hostile, authorName: hostile, tagline: { en: hostile },
      aboutRole: { en: hostile }, aboutGear: { en: hostile },
      socialLinks: [{ label: hostile, url: 'https://one.example/?q=%22%3E' }, { label: 'Second', url: 'https://two.example/' }],
    });
    const document = await about('en');
    expect(document.title).toBe('About me – ' + hostile);
    expect(document.querySelector('main h2')?.textContent).toBe(hostile);
    expect(document.querySelector('meta[property="og:site_name"]')?.getAttribute('content')).toBe(hostile);
    expect(document.querySelectorAll('img[onerror]')).toHaveLength(0);
    expect([...document.querySelectorAll('script')].some((script) => script.textContent?.includes('alert(1)'))).toBe(false);
    const links = [...document.querySelectorAll('footer a[target="_blank"]')];
    expect(links.map((link) => link.textContent)).toEqual([hostile + ' ↗', 'Second ↗']);
    expect(links.every((link) => link.getAttribute('rel') === 'noopener noreferrer')).toBe(true);
    const rss = await feed({ site: new URL('https://example.com'), currentLocale: 'en' });
    const xml = await rss.text();
    expect(xml).not.toContain('<img');
    expect(xml).not.toContain('</script>');
    expect(xml).toContain('&lt;');
  });

  it('does not fall back to another locale’s private profile text', async () => {
    Object.assign(identity, {
      tagline: { de: 'German only' }, aboutRole: { de: 'Private role' }, aboutGear: { de: 'Private equipment' },
    });
    const document = await about('en');
    expect(document.querySelector('footer')?.textContent).toContain('Travel stories');
    expect(document.body.textContent).not.toContain('Private');
    expect(document.body.textContent).not.toContain('German only');
  });

  it('drops a cleared locale’s equipment box and footer line through the build snapshot, keeping the other locale’s', async () => {
    // The About editor (#514) clears a locale by saving an empty line; the build hand-off carries it as such.
    const saved = { ...neutralIdentity(), ...legacy, canonicalOrigin: null, aboutGear: { de: 'Leica M6 · Kodak Portra', en: '' } };
    Object.assign(identity, parseIdentitySnapshot(JSON.stringify(toIdentitySnapshot(saved, ['de', 'en']))));
    const german = await about('de');
    expect(german.querySelector('main')?.textContent).toContain('Ausrüstung');
    expect(german.querySelector('main')?.textContent).toContain('Leica M6 · Kodak Portra');
    expect(german.querySelector('footer')?.textContent).toContain('Leica M6 · Kodak Portra');
    const english = await about('en');
    expect(english.querySelector('main')?.textContent).toContain(legacy.aboutRole.en);
    expect(english.querySelector('main')?.textContent).not.toContain('Equipment');
    expect(english.body.textContent).not.toContain('Leica');
  });

  it('carries the configured tagline into home, regional descriptions and the featured heading', async () => {
    identity.tagline.en = 'From the road';
    const container = await AstroContainer.create();
    const home = documentOf(await container.renderToString(HomePage, { props: { locale: 'en' }, request: new Request('https://example.com/en/') }));
    expect(home.querySelector('h1')?.textContent).toBe('From the road');
    expect(home.querySelector('meta[name="description"]')?.getAttribute('content')).toBe('From the road');
    const region = documentOf(await container.renderToString(RegionPage, { props: { locale: 'en' }, request: new Request('https://example.com/en/destinations/') }));
    expect(region.querySelector('meta[name="description"]')?.getAttribute('content')).toContain('From the road');
    const trip: Trip = {
      id: 'en/a-journey', collection: 'trips',
      data: {
        title: story.title, date: story.date, excerpt: story.excerpt, heroImage: story.image,
        country: 'Country', countryCode: 'DE', region: 'europe', translationKey: 'identity-fixture',
        coordinates: { lat: 1, lng: 2 },
      },
    };
    const hero = documentOf(await container.renderToString(FeaturedHero, { props: { trip } }));
    expect(hero.querySelector('h1')?.textContent).toBe('From the road');
  });

  it.each(['de', 'en'] as const)('renders the saved logo as one named home link with intrinsic dimensions in %s', async (locale) => {
    identity.siteName = 'Our field notes';
    identity.assets.logo = { path: '/_identity/logo-0123456789abcdef.png', width: 960, height: 240 };
    const document = await about(locale);
    const home = document.querySelector('header')?.querySelector('a');
    const logo = home?.querySelector('img');
    expect(home?.getAttribute('href')).toBe(locale === 'de' ? '/' : '/en/');
    expect(home?.querySelectorAll('img')).toHaveLength(1);
    expect(home?.textContent?.trim()).toBe('');
    expect(logo?.getAttribute('alt')).toBe('Our field notes');
    expect(logo?.getAttribute('src')).toBe('/_identity/logo-0123456789abcdef.png');
    expect(logo?.getAttribute('width')).toBe('960');
    expect(logo?.getAttribute('height')).toBe('240');
    home?.focus();
    expect(document.activeElement).toBe(home);
  });

  it.each(['de', 'en'] as const)('uses the localized fallback for an unnamed logo and restores text when removed in %s', async (locale) => {
    const before = await about(locale);
    const fallback = before.querySelector('header a')?.textContent?.trim();
    expect(fallback).toEqual(expect.any(String));
    expect(fallback).not.toBe('');
    identity.assets.logo = { path: '/_identity/logo-0123456789abcdef.png', width: 48, height: 240 };
    const custom = await about(locale);
    expect(custom.querySelector('header a img')?.getAttribute('alt')).toBe(fallback);
    identity.assets.logo = null;
    const removed = await about(locale);
    expect(removed.querySelector('header a img')).toBeNull();
    expect(removed.querySelector('header a')?.textContent?.trim()).toBe(fallback);
  });

  it('keeps a wide logo shrinkable within the mobile home link without clipping its focus ring', async () => {
    identity.assets.logo = { path: '/_identity/logo-0123456789abcdef.png', width: 960, height: 32 };
    const document = await about('de');
    const home = document.querySelector('header a');
    const logo = home?.querySelector('img');
    // Structural guards for the 320px browser check: no fixed logo width or
    // overflow clipping, and the navigation still gets its own mobile row.
    for (const element of [home, logo]) {
      expect(element?.classList.contains('min-w-0')).toBe(true);
      expect(element?.classList.contains('max-w-full')).toBe(true);
      expect(element?.className).not.toContain('overflow-hidden');
    }
    expect(home?.parentElement?.classList.contains('flex-col')).toBe(true);
    expect(document.querySelector('header nav')?.classList.contains('flex-wrap')).toBe(true);
  });

  it('escapes the configured name in logo alternative text', async () => {
    identity.siteName = '"><img src=x onerror=alert(1)>';
    identity.assets.logo = { path: '/_identity/logo-0123456789abcdef.png', width: 320, height: 80 };
    const document = await about('en');
    expect(document.querySelector('header a img')?.getAttribute('alt')).toBe(identity.siteName);
    expect(document.querySelectorAll('header img')).toHaveLength(1);
    expect(document.querySelectorAll('img[onerror]')).toHaveLength(0);
  });

  it.each(['de', 'en'] as const)('renders all saved favicon variants and restores the default on removal in %s', async (locale) => {
    identity.assets.favicon = {
      png32: '/_identity/favicon-32-0123456789abcdef.png',
      png192: '/_identity/favicon-192-fedcba9876543210.png',
      appleTouch180: '/_identity/apple-touch-180-abcdef0123456789.png',
    };
    const document = await about(locale);
    const icons = [...document.querySelectorAll('link[rel="icon"]')];
    expect(icons.map((icon) => ({
      href: icon.getAttribute('href'), type: icon.getAttribute('type'), sizes: icon.getAttribute('sizes'),
    }))).toEqual([
      { href: identity.assets.favicon.png32, type: 'image/png', sizes: '32x32' },
      { href: identity.assets.favicon.png192, type: 'image/png', sizes: '192x192' },
    ]);
    expect(document.querySelectorAll('link[rel="apple-touch-icon"]')).toHaveLength(1);
    expect(document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')).toBe(identity.assets.favicon.appleTouch180);
    expect(document.querySelector('link[href="/favicon.svg"]')).toBeNull();
    identity.assets.favicon = null;
    const removed = await about(locale);
    expect(removed.querySelectorAll('link[rel="icon"]')).toHaveLength(1);
    expect(removed.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe('/favicon.svg');
    expect(removed.querySelector('link[rel="icon"]')?.getAttribute('type')).toBe('image/svg+xml');
    expect(removed.querySelector('link[rel="apple-touch-icon"]')).toBeNull();
  });
});
