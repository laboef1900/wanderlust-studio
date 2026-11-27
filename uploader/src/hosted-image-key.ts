import { assertSafeKey } from './storage.js';

/** Extract the storage key from a canonical image base on this install. */
export function hostedImageKey(src: string, imageBase: string): string {
  const prefix = `${imageBase}/`;
  if (new URL(src).origin !== new URL(imageBase).origin || !src.startsWith(prefix)) {
    throw new Error('Image is outside the configured base.');
  }
  const key = src.slice(prefix.length);
  assertSafeKey(key);
  return key;
}
