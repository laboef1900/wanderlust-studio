/**
 * Static plotting chart for the home page's map band.
 *
 * @ai-context The band used to be navy plus `Contours` plus a decorative
 * 40px dashed `<pattern>` — a two-axis grid overlay with nothing under it —
 * a heading, a stats line and a ghost button. It occupied the first slot after
 * the hero, pushed the story grid below the fold, and asked for a click on the
 * strength of a verbal promise: there was no cartography anywhere on the page,
 * while `map-data.ts` already exported `tripPins()` and the app already
 * self-hosts the real basemap at `/map/`.
 *
 * This turns the same grid into an actual graticule with the real trips plotted
 * on it, over a real coastline. Two rules it holds to:
 *
 * @ai-warning Measured coastlines only — never a drawn one. The silhouette is
 * Natural Earth's 1:110m land layer (public domain), committed as degrees by
 * `scripts/build-coastlines.mjs` and clipped to this chart's own window by
 * `land-path.ts`. An approximated, smoothed or hand-tidied landmass would make
 * the band a picture of a map, and the pins would be plotted against a
 * fiction; the whole claim here is that every coordinate on screen is
 * surveyed. Do not edit `coastlines.ts` by hand, do not swap the source for a
 * "nicer looking" outline, and do not add graticule-free decoration to the
 * band. (The app self-hosts a real basemap at `/map/`, but that is a ~524 MB
 * PMTiles slice baked into the Docker image by the repo-root Dockerfile — it
 * does not exist in a checkout, so deriving this from it would break
 * `npm run build`, `astro check` and CI's `astro build` everywhere but the
 * container. See the design spec dated 2026-09-18.)
 *
 * @ai-warning No line joining the pins. Each pin is a separate trip, not a leg
 * of one journey — a polyline through them would draw a route that was never
 * travelled. The dashed route divider elsewhere on the site is ornament with no
 * data behind it; this chart has data behind it and must not overclaim.
 */

import { LAND_RINGS } from './coastlines.js';
import { landPath } from './land-path.js';

export interface ChartPin {
  x: number;
  y: number;
  title: string;
  href?: string;
}
export interface ChartGridLine {
  /** Position along the axis, in viewBox units. */
  at: number;
  /** Formatted degree label, e.g. `60°W`, `0°`, `40°N`. */
  label: string;
  /**
   * Where the label's baseline goes along the constrained axis, kept far
   * enough from the frame that no glyph is clipped. For a meridian this is
   * `at`; for a parallel it is `at` nudged above its line and clamped.
   */
  labelAt: number;
  /** True for the equator and the prime meridian, which are drawn stronger. */
  primary: boolean;
}
export interface MapChart {
  width: number;
  height: number;
  viewBox: string;
  meridians: ChartGridLine[];
  parallels: ChartGridLine[];
  pins: ChartPin[];
  /**
   * Land silhouette as SVG path data in viewBox units, clipped to the window
   * and meant for `fill-rule="evenodd"`. Empty string when no ring intersects
   * the window, so the caller omits the element rather than emitting `d=""`.
   */
  land: string;
  /** Baseline for the meridian labels along the bottom edge. */
  labelBaseline: number;
}

export interface ChartInput {
  lng: number;
  lat: number;
  title: string;
  href?: string;
}

/** viewBox width; height follows from the fitted aspect ratio. */
const WIDTH = 1000;
/**
 * Width:height the fitted bounds are expanded to.
 *
 * Wide on purpose: the band closes the home page, and a panel-shaped chart
 * would dwarf the heading beside it. 2.2 (was 2.8 until 2026-10-18, when the
 * owner asked for a taller map) keeps it a broad strip with more latitude
 * shown. Exported so the test measures the real value instead of restating it.
 */
export const TARGET_ASPECT = 2.2;
/** Padding around the data, as a fraction of its own span. */
const PAD_FRACTION = 0.12;
/** Minimum padding in degrees, so a single pin still gets a readable window. */
const MIN_PAD = 8;
/** Graticule steps, coarsest last; the first that yields ≤6 lines per axis wins. */
const STEPS = [5, 10, 15, 20, 30, 45, 60, 90] as const;
const MAX_LINES = 6;
/**
 * Largest label font-size in viewBox units, i.e. the stacked layout's — an SVG
 * `font-size` is in viewBox units, so MapTeaser.astro sets two (30 stacked, 17
 * side-by-side) to land on a stable rendered size. The clamps below reserve
 * room for the bigger one, since a label clipped by the frame is worse than
 * one sitting slightly off its line.
 */
const LABEL_SIZE = 30;
/** Gap between a parallel's line and the label above it. */
const LABEL_LIFT = 8;
/**
 * Ascent above the baseline, as a multiple of the label size. Measured, not
 * assumed: `getBBox()` on a 30-unit `60°N` in IBM Plex Mono reports 31.4 units
 * above the baseline — the degree ring sits above the cap height, so a 1.0em
 * reserve still clipped the glyph by 1.4 units on a phone.
 */
const LABEL_ASCENT = 1.1;

/**
 * Project trips onto an equirectangular chart sized for the band.
 *
 * Equirectangular, not Web Mercator: the real map at `/map/` is Mercator, but
 * this is a 1000-unit-wide strip covering a fraction of the globe where the
 * two barely differ, and a linear latitude axis is what makes the labelled
 * parallels honest at this size.
 */
export function mapChart(input: ChartInput[]): MapChart | null {
  if (input.length === 0) return null;

  const lngs = input.map((p) => p.lng);
  const lats = input.map((p) => p.lat);
  let [west, east] = padded(Math.min(...lngs), Math.max(...lngs), -180, 180);
  let [south, north] = padded(Math.min(...lats), Math.max(...lats), -90, 90);

  // Expand the axis that is short of the target aspect, around the data's own
  // centre, so `preserveAspectRatio="xMidYMid meet"` never has to crop a pin.
  const aspect = (east - west) / (north - south);
  if (aspect < TARGET_ASPECT) {
    const want = (north - south) * TARGET_ASPECT;
    [west, east] = grow(west, east, want, -180, 180);
  } else if (aspect > TARGET_ASPECT) {
    const want = (east - west) / TARGET_ASPECT;
    [south, north] = grow(south, north, want, -90, 90);
  }

  const lngSpan = east - west;
  const latSpan = north - south;
  const height = Math.round((WIDTH * latSpan) / lngSpan);
  const x = (lng: number) => round(((lng - west) / lngSpan) * WIDTH);
  const y = (lat: number) => round(((north - lat) / latSpan) * height);

  // Meridian labels sit on one baseline along the bottom; a descender at the
  // largest label size still clears the frame.
  const labelBaseline = height - LABEL_SIZE * 0.35;
  const clampBaseline = (v: number) =>
    round(Math.min(Math.max(v, LABEL_SIZE * LABEL_ASCENT), labelBaseline - LABEL_SIZE * 0.6));
  return {
    width: WIDTH,
    height,
    viewBox: `0 0 ${WIDTH} ${height}`,
    labelBaseline: round(labelBaseline),
    // Clipped and projected here, where the window is known, so the emitted
    // path is the visible coast and nothing else.
    land: landPath(LAND_RINGS, { west, east, south, north }, { x, y }),
    meridians: graticuleTicks(west, east).map((lng) => ({
      at: x(lng),
      labelAt: x(lng),
      label: degreeLabel(lng, 'E', 'W'),
      primary: lng === 0,
    })),
    parallels: graticuleTicks(south, north).map((lat) => ({
      at: y(lat),
      labelAt: clampBaseline(y(lat) - LABEL_LIFT),
      label: degreeLabel(lat, 'N', 'S'),
      primary: lat === 0,
    })),
    pins: input.map((p) => ({ x: x(p.lng), y: y(p.lat), title: p.title, href: p.href })),
  };
}

function padded(lo: number, hi: number, min: number, max: number): [number, number] {
  const pad = Math.max((hi - lo) * PAD_FRACTION, MIN_PAD);
  return [Math.max(min, lo - pad), Math.min(max, hi + pad)];
}

/** Widen [lo, hi] to `want` around its midpoint, staying inside [min, max]. */
function grow(lo: number, hi: number, want: number, min: number, max: number): [number, number] {
  const limit = max - min;
  const span = Math.min(want, limit);
  const mid = (lo + hi) / 2;
  let a = mid - span / 2;
  let b = mid + span / 2;
  if (a < min) {
    b += min - a;
    a = min;
  }
  if (b > max) {
    a -= b - max;
    b = max;
  }
  return [a, b];
}

/**
 * Graticule values inside [lo, hi] at the coarsest step that stays readable.
 * Shared with the travel map page's graticule, so both charts use one step
 * ladder and one label format.
 */
export function graticuleTicks(lo: number, hi: number): number[] {
  const step = STEPS.find((s) => Math.floor(hi / s) - Math.ceil(lo / s) + 1 <= MAX_LINES) ?? 90;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}

/** "30°E", "15°S", "0°" — the chart's degree label. */
export function degreeLabel(value: number, positive: string, negative: string): string {
  const v = round(value);
  if (v === 0) return '0°';
  return `${Math.abs(v)}°${v > 0 ? positive : negative}`;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Truncate a trip title to a compact label for the small overview chart. */
export function shortPinTitle(title: string, maxChars = 20): string {
  const trimmed = title.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const cut = trimmed.slice(0, maxChars - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const head = lastSpace >= Math.floor(maxChars / 2) ? cut.slice(0, lastSpace) : cut;
  return `${head.replace(/[\s,:;–—-]+$/u, '')}…`;
}

/** Font size of the teaser pin pill in viewBox units; MapTeaser scales the whole pill at `lg`. */
export const PILL_FONT_SIZE = 22;
const PILL_CHAR_WIDTH = 0.6 * PILL_FONT_SIZE; // generous Inter 600 average, so text never touches the ends
const PILL_PAD_X = 16;
const PILL_HEIGHT = 40;
const PILL_TAIL = 10; // tail length
const PILL_TAIL_HALF = 9; // half the tail's base
const PILL_GAP = 8; // tail tip to the pin centre, clears the 4.5-unit dot
const PILL_EDGE = 4; // minimum distance to the chart frame

export interface PinPill {
  /** One closed outline: rounded pill plus the tail whose tip sits on the pin. */
  d: string;
  /** Text centre (use `text-anchor="middle"` and `dy="0.35em"`). */
  textX: number;
  textY: number;
  /** True when the pill hangs below the pin because there is no room above it. */
  below: boolean;
}

/**
 * Geometry of the hover pill for a teaser pin. The pill sits above the pin
 * (below it when the top of the chart would clip it), slides sideways to stay
 * inside the frame, and its tail always points at the pin itself.
 */
export function pinPill(pin: { x: number; y: number }, label: string, chart: { width: number; height: number }): PinPill {
  const width = Math.round([...label].length * PILL_CHAR_WIDTH + 2 * PILL_PAD_X);
  const r = PILL_HEIGHT / 2;
  const left = round(Math.min(Math.max(pin.x - width / 2, PILL_EDGE), chart.width - width - PILL_EDGE));
  const right = round(left + width);
  const below = pin.y - PILL_GAP - PILL_TAIL - PILL_HEIGHT < PILL_EDGE;
  const dir = below ? 1 : -1;
  const tip = round(pin.y + dir * PILL_GAP);
  const edge = round(tip + dir * PILL_TAIL); // the pill side the tail grows from
  const far = round(edge + dir * PILL_HEIGHT);
  // Keep the tail base on the straight run of the pill, even when the pin is near a frame edge.
  const baseX = round(Math.min(Math.max(pin.x, left + r + PILL_TAIL_HALF), right - r - PILL_TAIL_HALF));
  const tipX = round(pin.x);
  const top = Math.min(edge, far);
  const bottom = Math.max(edge, far);
  const arcs = `A${r} ${r} 0 0 1 ${left + r} ${top}`;
  // Clockwise from the top-left end of the straight top run.
  const topRun = below
    ? `L${baseX - PILL_TAIL_HALF} ${top} L${tipX} ${tip} L${baseX + PILL_TAIL_HALF} ${top} L${right - r} ${top}`
    : `L${right - r} ${top}`;
  const bottomRun = below
    ? `L${left + r} ${bottom}`
    : `L${baseX + PILL_TAIL_HALF} ${bottom} L${tipX} ${tip} L${baseX - PILL_TAIL_HALF} ${bottom} L${left + r} ${bottom}`;
  const d =
    `M${left + r} ${top} ${topRun} A${r} ${r} 0 0 1 ${right - r} ${bottom} ${bottomRun} ${arcs} Z`;
  return { d, textX: round(left + width / 2), textY: round((top + bottom) / 2), below };
}
