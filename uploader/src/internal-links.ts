import { isPageKind } from '../../site/src/lib/page-kinds.js';
import { journeysIndexPath, journeyPath, regionSlugs, regions, type Region } from '../../site/src/lib/paths.js';
import { ui } from '../../site/src/i18n/ui.js';
import type { LanguageConfig, LanguageLocale } from './language.js';
import type { PageStore } from './pages.js';
import type { JourneyStore, StoredJourney } from './journeys.js';
import type { PostStore, PostSummary } from './posts.js';
import { publicPath } from './public-paths.js';

export type InternalLinkKind = 'home' | 'about' | 'map' | 'regions' | 'journeys'
  | 'region' | 'page' | 'story' | 'journey';

export interface InternalLinkTarget {
  id: string;
  kind: InternalLinkKind;
  title: string;
  path: string;
  alternatePath: string | null;
}
export interface InternalLinkCatalog {
  locale: LanguageLocale;
  alternateLocale: LanguageLocale | null;
  targets: InternalLinkTarget[];
  links: { from: string; to: string }[];
}
export interface InternalLinkSources {
  language: LanguageConfig;
  posts: Pick<PostStore, 'list'>;
  pages: Pick<PageStore, 'getAll' | 'keys' | 'get'>;
  journeys?: Pick<JourneyStore, 'list'>;
}

export async function readInternalLinkCatalog(sources: InternalLinkSources, locale: LanguageLocale): Promise<InternalLinkCatalog> {
  const mode = sources.language;
  if (!mode.locales.includes(locale)) throw new Error('Locale is not enabled');
  const alternate = mode.locales.find((entry) => entry !== locale) ?? null;
  const targets = new Map<string, InternalLinkTarget>();
  const add = (target: InternalLinkTarget) => {
    if (!targets.has(target.path)) targets.set(target.path, target);
  };

  for (const kind of ['home', 'map', 'regions'] as const) {
    add({
      id: `builtin:${kind}`, kind, title: '',
      path: publicPath(mode, locale, kind),
      alternatePath: alternate ? publicPath(mode, alternate, kind) : null,
    });
  }

  const pages = sources.pages.getAll
    ? await sources.pages.getAll()
    : await Promise.all((await sources.pages.keys()).map((key) => sources.pages.get(key)));
  const about = pages.find((pair) => pair.key === 'about');
  add({
    id: 'page:about', kind: 'about', title: about?.[locale].title ?? '',
    path: publicPath(mode, locale, 'about'),
    alternatePath: alternate ? publicPath(mode, alternate, 'about') : null,
  });

  for (const pair of pages) {
    if (pair.key === 'about' || !isPageKind(pair.key) || pair.status !== 'published') continue;
    const slug = pair[locale].slug;
    if (pair[locale].publishedAt === null || !slug) continue;
    const alternateSlug = alternate ? pair[alternate].slug : '';
    const alternateLive = alternate !== null && pair[alternate].publishedAt !== null && Boolean(alternateSlug);
    add({
      id: `page:${pair.key}`, kind: 'page', title: pair[locale].title,
      path: publicPath(mode, locale, 'story', slug),
      alternatePath: alternateLive ? publicPath(mode, alternate!, 'story', alternateSlug!) : null,
    });
  }

  const posts = await sources.posts.list();
  const byKey = new Map<string, PostSummary>(posts.map((post) => [post.translationKey, post]));
  const liveRegions: Record<LanguageLocale, Set<Region>> = { de: new Set(), en: new Set() };
  for (const post of posts) {
    const live = post.publishedLocales[locale];
    if (!live?.slug) continue;
    const alt = alternate ? post.publishedLocales[alternate] : null;
    add({
      id: `story:${post.translationKey}`, kind: 'story', title: live.title,
      path: publicPath(mode, locale, 'story', live.slug),
      alternatePath: alt?.slug ? publicPath(mode, alternate!, 'story', alt.slug) : null,
    });
    if (Object.hasOwn(regionSlugs, live.region)) liveRegions[locale].add(live.region as Region);
    if (alternate && alt && Object.hasOwn(regionSlugs, alt.region)) liveRegions[alternate].add(alt.region as Region);
  }

  for (const region of regions) {
    if (!liveRegions[locale].has(region)) continue;
    add({
      id: `region:${region}`, kind: 'region',
      title: ui[locale][`region.${region}` as keyof typeof ui.de],
      path: publicPath(mode, locale, 'region', regionSlugs[region][locale]),
      alternatePath: alternate && liveRegions[alternate].has(region)
        ? publicPath(mode, alternate, 'region', regionSlugs[region][alternate]) : null,
    });
  }

  const journeys = sources.journeys ? await sources.journeys.list() : [];
  const journeyEntry = (journey: StoredJourney, entry: LanguageLocale) => {
    const snapshot = journey.publishedSnapshot;
    if (journey.status !== 'published' || !snapshot) return null;
    const content = snapshot.locales[entry];
    if (!content?.slug || !/^[a-z0-9][a-z0-9-]*$/.test(content.slug)) return null;
    const membersLive = snapshot.members.some((key) => byKey.get(key)?.publishedLocales[entry]);
    return membersLive ? content : null;
  };
  let anyJourney = false;
  let anyAlternateJourney = false;
  for (const journey of journeys) {
    const live = journeyEntry(journey, locale);
    if (!live) continue;
    anyJourney = true;
    const alt = alternate ? journeyEntry(journey, alternate) : null;
    if (alt) anyAlternateJourney = true;
    add({
      id: `journey:${journey.id}`, kind: 'journey', title: live.title,
      path: journeyPath(live.slug, locale, mode),
      alternatePath: alt ? journeyPath(alt.slug, alternate!, mode) : null,
    });
  }
  if (anyJourney) {
    add({
      id: 'builtin:journeys', kind: 'journeys', title: '',
      path: journeysIndexPath(locale, mode),
      alternatePath: alternate && anyAlternateJourney ? journeysIndexPath(alternate, mode) : null,
    });
  }

  const catalog = { locale, alternateLocale: alternate, targets: [...targets.values()] };
  return { ...catalog, links: translationLinkMap(catalog) };
}

export function translationLinkMap(catalog: Pick<InternalLinkCatalog, 'targets'>): { from: string; to: string }[] {
  const seen = new Set<string>();
  const links: { from: string; to: string }[] = [];
  for (const target of catalog.targets) {
    if (!target.alternatePath || seen.has(target.path)) continue;
    seen.add(target.path);
    links.push({ from: target.path, to: target.alternatePath });
  }
  return links;
}
