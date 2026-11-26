import { ui } from '../i18n/ui.js';
import { parseIdentitySnapshot, type IdentityLocale } from './site-identity.js';
import { imageOrigin, retargetImageOrigins, type RemoteHeroImage } from './images.js';

// Site-only boundary: server imports of the pure validator never read operator env.
export const identity = parseIdentitySnapshot(process.env.SITE_IDENTITY_JSON);
export function buildSiteOrigin(): string {
  return identity.canonicalOrigin ?? 'https://unconfigured.invalid';
}
export function identitySiteName(locale: IdentityLocale): string {
  return identity.siteName || ui[locale]['site.titleFallback'];
}
export function identityTagline(locale: IdentityLocale): string {
  return identity.tagline[locale] || ui[locale]['site.taglineFallback'];
}
export function identityPortrait(locale: IdentityLocale): RemoteHeroImage | null {
  const portrait = identity.aboutPortrait[locale];
  if (!portrait) return null;
  const { heroSrc } = retargetImageOrigins({ heroSrc: portrait.src, images: {}, body: '' }, imageOrigin(process.env.PUBLIC_BASE_URL));
  return { ...portrait, src: heroSrc };
}
