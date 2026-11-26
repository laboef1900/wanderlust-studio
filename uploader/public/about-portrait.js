// The shared controller owns saves and reloads. This panel owns only the photo
// being edited; choosing or removing one does not write to the media library.
AboutIdentity.register('Portrait', function ({ el, locale, copy, onUnauthed, edited }) {
  const input = el('Alt'), choose = el('Choose'), remove = el('Remove'), preview = el('Preview');
  let photo;
  el('Heading').textContent = copy.aboutPortraitHeading;
  el('Empty').textContent = copy.aboutPortraitEmpty;
  el('AltHelp').textContent = copy.aboutPortraitAltHelp;
  choose.textContent = copy.aboutPortraitChoose;
  remove.textContent = copy.aboutPortraitRemove;

  function write(value) {
    photo = value;
    input.value = value?.alt ?? '';
    input.required = !!value;
    preview.hidden = !value;
    el('Empty').hidden = !!value;
    if (value) {
      // Restored portraits may still name the previous install. Like the public
      // build, fetch the variant only from this installation's image origin.
      preview.src = PostsFilter.thumbUrl({ heroSrc: EditorGalleryImageOrigin + new URL(value.src).pathname,
        heroWidth: value.width, heroFormat: value.format });
      preview.style.objectPosition = value.focus ? `${value.focus.x}% ${value.focus.y}%` : '';
    } else preview.removeAttribute('src');
  }
  choose.addEventListener('click', () => {
    if (choose.disabled) return;
    // Native <dialog> restores the previously focused element on Choose, Cancel
    // and Escape. Pointer activation need not itself focus a button (Safari).
    choose.focus();
    MediaPicker.open({ onUnauthed, onPick(item) {
      if (choose.disabled) return;
      write({ src: item.src, width: item.width, height: item.height,
        alt: input.value.trim() ? input.value : item.alt?.[locale] ?? '',
        ...(item.format ? { format: item.format } : {}), ...(item.focus ? { focus: item.focus } : {}) });
      edited();
    } });
  });
  remove.addEventListener('click', () => {
    if (remove.disabled) return;
    write(undefined);
    edited();
    choose.focus();
  });
  return {
    input, entry: choose, max: 300, write,
    read: () => photo && { ...photo, alt: AboutIdentity.measure(input.value).normalized },
    dirty: (saved) => photo?.src !== saved?.src || photo?.width !== saved?.width || photo?.height !== saved?.height
      || photo?.format !== saved?.format || photo?.focus?.x !== saved?.focus?.x || photo?.focus?.y !== saved?.focus?.y
      || input.value !== (saved?.alt ?? ''),
    lock(locked) { choose.disabled = locked; input.disabled = remove.disabled = locked || !photo; },
  };
});
