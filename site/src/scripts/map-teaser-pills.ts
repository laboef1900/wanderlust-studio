/**
 * Shows each home map pin's pill while the pin is hovered or focused.
 *
 * The pills paint in one layer after every pin (MapTeaser.astro), so no later
 * pin's dot covers an open pill. That also puts each pill out of reach of its
 * pin's own `:hover`. `:has(:hover)` would bridge it in CSS, but WebKit does not
 * reliably restyle on it: pills stayed open after the pointer left, or never
 * opened. So the pin's state is mirrored onto its pill as `is-active`.
 */
export function initMapTeaserPills(chart: SVGSVGElement): void {
  for (const pin of chart.querySelectorAll<SVGAElement>('a.chart-pin[data-pin]')) {
    const pill = chart.querySelector(`a.chart-pin-pill-link[data-pin="${pin.dataset.pin}"]`);
    if (!pill) continue;
    let hovered = false;
    let focused = false;
    const sync = () => pill.classList.toggle('is-active', hovered || focused);
    pin.addEventListener('pointerenter', () => {
      hovered = true;
      sync();
    });
    pin.addEventListener('pointerleave', () => {
      hovered = false;
      sync();
    });
    pin.addEventListener('focus', () => {
      focused = true;
      sync();
    });
    pin.addEventListener('blur', () => {
      focused = false;
      sync();
    });
  }
}
