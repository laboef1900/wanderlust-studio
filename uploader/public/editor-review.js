// Advisory review of one unsaved locale. The editor owns fields/slug rules;
// this controller owns the dialog, request lifetime, and explicit review actions.
window.EditorReview = (function () {
  'use strict';

  const quickChecks = [
    ['title', 'Title length'], ['excerpt', 'Excerpt length'],
    ['headings', 'Heading hierarchy'], ['altText', 'Alt text'],
    ['internalLinks', 'Internal links'],
  ];
  const semanticChecks = ['title', 'excerpt', 'headings', 'practicalDetails', 'altText', 'internalLinks'];
  const statusLabels = { pass: 'Pass', warn: 'Warning', info: 'Suggestion' };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // A 30-photo gallery without descriptions is one finding, not thirty: the
  // fix happens in Media for all of them. The jump goes to the first photo.
  function groupGalleryAlt(findings) {
    const grouped = [];
    const galleries = new Map();
    for (const finding of findings) {
      if (finding.code !== 'missing-alt' || finding.target !== 'gallery' || !Number.isInteger(finding.gallery)) {
        grouped.push(finding);
        continue;
      }
      const group = galleries.get(finding.gallery);
      if (group) { group.count += 1; continue; }
      const first = { ...finding, count: 1 };
      galleries.set(finding.gallery, first);
      grouped.push(first);
    }
    return grouped.map((finding) => finding.count > 1
      ? { ...finding, message: finding.count + ' photos in this gallery have no alt text. Gallery photos from Media are described in Media.' }
      : finding);
  }

  function mediaLink() {
    const link = element('a', 'review-media-link', 'Open Media');
    link.href = '/admin/media.html';
    link.target = '_blank';
    link.rel = 'noopener';
    link.appendChild(element('span', 'visually-hidden', ' (opens a new tab)'));
    return link;
  }

  function card(criterion, title, status) {
    const node = element('article', 'review-card');
    node.dataset.reviewCriterion = criterion;
    const head = element('div', 'review-card__head');
    head.appendChild(element('h4', '', title));
    head.appendChild(element('span', 'status-badge review-badge review-badge--' + status, statusLabels[status]));
    node.appendChild(head);
    return node;
  }

  function create(options) {
    const byId = (id) => document.getElementById(id);
    const dialog = byId('storyReviewDialog');
    const trigger = byId('reviewStory');
    const closeButton = byId('closeReview');
    const runButton = byId('runReview');
    const instant = byId('reviewInstant');
    const semantic = byId('reviewSemantic');
    const status = byId('reviewStatus');
    const copy = EditorCopy.en;
    const destination = byId('reviewDestination');
    byId('reviewData').textContent = copy.reviewData;
    runButton.textContent = copy.reviewPrepare;
    const criterionTitle = {
      title: copy.reviewCriterionTitle,
      excerpt: copy.reviewCriterionExcerpt,
      headings: copy.reviewCriterionHeadings,
      practicalDetails: copy.reviewCriterionPracticalDetails,
      altText: copy.reviewCriterionAltText,
      internalLinks: copy.reviewCriterionInternalLinks,
    };
    let epoch = 0;
    let active = null;
    let applying = false;
    let queuedCloseEvents = 0;

    function owns(request) {
      return active === request && request.epoch === epoch && dialog.open &&
        !request.controller.signal.aborted && options.isCurrent(request.snapshot);
    }

    function release() {
      epoch = (epoch + 1) % Number.MAX_SAFE_INTEGER;
      if (active) active.controller.abort();
      active = null;
      semantic.setAttribute('aria-busy', 'false');
      destination.textContent = '';
      destination.hidden = true;
      runButton.disabled = true;
    }

    function clearResults() {
      instant.replaceChildren();
      semantic.replaceChildren();
      status.replaceChildren();
      status.className = 'review-status';
      byId('reviewLocale').textContent = '';
    }

    function focusTrigger() {
      const menu = trigger.closest('details');
      // On phones Review lives in More, which closes when its action runs.
      // Return to the visible menu opener rather than a hidden button.
      const target = menu && !menu.open ? menu.querySelector('summary') : trigger;
      target.focus();
    }

    function close(restoreFocus) {
      release();
      clearResults();
      if (dialog.open) {
        // Native close events are queued. Consume THIS event even if another
        // review opens first; a late close must not cancel it or steal jump focus.
        queuedCloseEvents++;
        dialog.close();
      }
      if (restoreFocus) focusTrigger();
    }

    function invalidate() {
      // input still reaches DraftGuard and slugAuto during our explicit apply.
      // Only this synchronous action keeps the other suggestions usable.
      if (!applying && (active || dialog.open)) close(false);
    }

    function say(message, loading) {
      status.replaceChildren();
      status.className = 'review-status';
      semantic.setAttribute('aria-busy', loading ? 'true' : 'false');
      if (loading) {
        const spinner = element('span', 'review-spinner');
        spinner.setAttribute('aria-hidden', 'true');
        status.appendChild(spinner);
      }
      status.appendChild(element('p', '', message));
    }

    function unavailable(message, settings) {
      runButton.disabled = false;
      runButton.textContent = active?.prepared ? copy.reviewStart : copy.reviewPrepare;
      say(message, false);
      status.className = 'review-status notice-warn';
      status.appendChild(element('span', 'status-badge review-badge review-badge--warn', 'Warning'));
      if (settings) {
        if (options.isAdmin()) {
          const link = element('a', 'review-settings-link', 'Open AI settings');
          link.href = '/admin/settings.html';
          status.appendChild(link);
        } else {
          status.appendChild(element('p', '', copy.reviewAdminHelp));
        }
      }
    }

    function jumpButton(request, finding) {
      if (finding.target !== 'hero' && (!Number.isInteger(finding.line) || finding.line < 1)) return null;
      const button = element('button', 'btn-link review-jump', finding.target === 'hero' ? 'Go to hero alt text' : 'Go to line ' + finding.line);
      button.type = 'button';
      button.dataset.reviewAction = 'jump';
      if (finding.target === 'hero') button.dataset.target = 'hero';
      else button.dataset.line = String(finding.line);
      button.addEventListener('click', () => {
        if (!owns(request)) return;
        const locale = request.snapshot.story.locale;
        close(false);
        options.jump(locale, finding);
      });
      return button;
    }

    async function renderInstant(request, story) {
      let result;
      try { result = await window.EditorLinter.lintStory(story || request.snapshot.story); }
      catch (error) {
        if (!owns(request)) return;
        if (error?.status === 401) { invalidate(); options.on401(); return; }
        const copy = EditorGalleryCopy.en;
        instant.replaceChildren(element('p', '', copy.analysisFailed));
        const retry = element('button', 'btn-secondary', copy.retry);
        retry.type = 'button';
        retry.addEventListener('click', () => { if (owns(request)) void renderInstant(request); });
        instant.appendChild(retry);
        return;
      }
      if (!owns(request)) return;
      instant.replaceChildren();
      for (const [key, title] of quickChecks) {
        const check = result[key];
        const node = card(key, title, check.status);
        if (key === 'title' || key === 'excerpt') {
          const range = key === 'title' ? '20–70' : '100–160';
          node.appendChild(element('p', 'review-count', check.count + ' characters · aim for ' + range));
          if (check.message) node.appendChild(element('p', '', check.message));
        } else {
          if (key === 'internalLinks') {
            node.appendChild(element('p', 'review-count', check.count + (check.count === 1 ? ' relative link found' : ' relative links found')));
          }
          if (check.findings.length) {
            const list = element('ul', 'review-findings');
            for (const finding of groupGalleryAlt(check.findings)) {
              const item = element('li');
              item.appendChild(element('p', '', finding.message));
              const jump = jumpButton(request, finding);
              if (jump) item.appendChild(jump);
              if (finding.count > 1) item.appendChild(mediaLink());
              list.appendChild(item);
            }
            node.appendChild(list);
          } else if (key !== 'internalLinks') {
            node.appendChild(element('p', '', key === 'headings'
              ? 'No skipped levels or body H1 headings found.'
              : 'No missing alt text found in the checked images.'));
          }
        }
        instant.appendChild(node);
      }
    }

    function suggestion(request, node, field, value, index) {
      if (!value.trim()) return;
      const group = element('div', 'review-suggestion');
      const text = element('p', 'review-suggestion__text', value);
      text.id = 'review-suggestion-' + request.epoch + '-' + field + '-' + index;
      text.lang = request.snapshot.story.locale;
      group.appendChild(text);
      const label = 'Apply suggested ' + field;
      const button = element('button', 'btn-secondary', label);
      button.type = 'button';
      button.dataset.reviewAction = field;
      button.setAttribute('aria-describedby', text.id);
      button.addEventListener('click', () => {
        if (!owns(request)) return;
        applying = true;
        try {
          options.apply(request.snapshot.story.locale, field, value);
        } finally {
          applying = false;
        }
        if (!owns(request)) return;
        // If a different title is chosen, only the current choice says Applied.
        for (const other of semantic.querySelectorAll('[data-review-action="' + field + '"]')) {
          other.disabled = false;
          other.textContent = label;
        }
        button.disabled = true;
        button.textContent = 'Applied ' + field;
        say('Suggested ' + field + ' applied to this draft. Nothing has been saved; other suggestions still refer to the reviewed snapshot.', false);
      });
      group.appendChild(button);
      node.appendChild(group);
    }

    function renderSemantic(request, result) {
      semantic.replaceChildren();
      request.result = result;
      request.answers = [];
      request.notesInput = null;
      request.updateButton = null;
      request.cancelButton = null;
      request.updateStatus = null;
      request.disclosure = null;
      request.previewContainer = null;
      request.applyButton = null;
      request.undoButton = null;
      request.updatePromptInvalid = false;
      for (const key of semanticChecks) {
        const check = result[key];
        const node = card(key, criterionTitle[key], check.status);
        if (check.critique) {
          const critique = element('p', '', check.critique);
          critique.lang = request.snapshot.story.locale;
          node.appendChild(critique);
        }
        if (key === 'practicalDetails') {
          renderPracticalAnswers(request, node, check, request.snapshot.story.locale);
        } else if (key === 'altText') {
          if (check.missingImages && check.missingImages.length) {
            node.appendChild(element('p', 'review-update__intro', copy.reviewAltTextMissingImages));
            const list = element('ul', 'review-findings');
            list.lang = request.snapshot.story.locale;
            for (const image of check.missingImages) list.appendChild(element('li', '', image));
            node.appendChild(list);
          }
        } else if (key === 'internalLinks') {
          if (check.linkOpportunities.length) {
            const list = element('ul', 'review-findings');
            list.lang = request.snapshot.story.locale;
            for (const item of check.linkOpportunities) list.appendChild(element('li', '', item));
            node.appendChild(list);
          } else {
            node.appendChild(element('p', '', 'No additional link opportunities suggested.'));
          }
        }
        if (key === 'title') (check.suggestions || []).forEach((value, index) => suggestion(request, node, key, value, index));
        if (key === 'excerpt' && check.suggestedExcerpt) suggestion(request, node, key, check.suggestedExcerpt, 0);
        semantic.appendChild(node);
      }
    }

    // ---- #630 practical-details answers and article update ----

    function renderPracticalAnswers(request, node, practicalDetails, locale) {
      const missingAspects = practicalDetails.missingAspects || [];
      if (!missingAspects.length) return;
      request.missingAspects = missingAspects;
      node.appendChild(element('p', 'review-update__intro', copy.reviewAnswersIntro));
      missingAspects.forEach((aspect, i) => {
        const group = element('div', 'review-answer__group');
        const id = 'review-answer-' + request.epoch + '-' + i;
        const label = element('label', 'review-answer__label', aspect);
        label.setAttribute('for', id);
        label.lang = locale;
        const input = element('textarea', 'review-answer__input');
        input.id = id;
        input.setAttribute('rows', '2');
        input.setAttribute('maxlength', '2000');
        input.lang = locale;
        group.appendChild(label);
        group.appendChild(input);
        group.appendChild(element('p', 'review-answer__help', copy.reviewAnswerHelp.replace('{max}', '2000')));
        node.appendChild(group);
        request.answers.push({ aspect, input });
        input.addEventListener('input', () => onUpdateInput(request));
      });
      const notesGroup = element('div', 'review-notes');
      const notesId = 'review-notes-' + request.epoch;
      const notesLabel = element('label', 'review-notes__label', copy.reviewNotesLabel);
      notesLabel.setAttribute('for', notesId);
      const notesInput = element('textarea', 'review-notes__input');
      notesInput.id = notesId;
      notesInput.setAttribute('rows', '3');
      notesInput.setAttribute('maxlength', '4000');
      notesInput.lang = locale;
      notesGroup.appendChild(notesLabel);
      notesGroup.appendChild(notesInput);
      notesGroup.appendChild(element('p', 'review-notes__help', copy.reviewNotesHelp.replace('{max}', '4000')));
      node.appendChild(notesGroup);
      request.notesInput = notesInput;
      notesInput.addEventListener('input', () => onUpdateInput(request));

      const disclosureId = 'review-update-disclosure-' + request.epoch;
      const disclosure = element('p', 'review-update__disclosure muted', '');
      disclosure.id = disclosureId;
      request.disclosure = disclosure;
      node.appendChild(disclosure);
      if (request.prepared) discloseUpdate(request, request.prepared);
      const updateStatus = element('div', 'review-status review-update__status');
      updateStatus.setAttribute('role', 'status');
      updateStatus.setAttribute('aria-live', 'polite');
      updateStatus.setAttribute('aria-atomic', 'true');
      request.updateStatus = updateStatus;
      node.appendChild(updateStatus);
      const actions = element('div', 'review-update__actions');
      const updateButton = element('button', 'btn-secondary', copy.reviewUpdateArticle);
      updateButton.type = 'button';
      updateButton.dataset.reviewAction = 'updateArticle';
      updateButton.setAttribute('aria-describedby', disclosureId);
      updateButton.addEventListener('click', () => { if (owns(request)) void update(request); });
      request.updateButton = updateButton;
      const cancelButton = element('button', 'btn-secondary', copy.reviewCancelUpdate);
      cancelButton.type = 'button';
      cancelButton.dataset.reviewAction = 'cancelUpdate';
      cancelButton.hidden = true;
      cancelButton.addEventListener('click', () => cancelUpdate(request));
      request.cancelButton = cancelButton;
      actions.appendChild(updateButton);
      actions.appendChild(cancelButton);
      node.appendChild(actions);
      request.previewContainer = element('div', 'review-update-preview');
      node.appendChild(request.previewContainer);
      renderUpdateState(request);
    }

    function setUpdateStatus(request, message, loading, extraClass) {
      const el = request.updateStatus;
      if (!el) return;
      el.replaceChildren();
      el.className = 'review-status review-update__status' + (extraClass ? ' ' + extraClass : '');
      if (loading) {
        const spinner = element('span', 'review-spinner');
        spinner.setAttribute('aria-hidden', 'true');
        el.appendChild(spinner);
      }
      el.appendChild(element('p', '', message));
    }

    function updateBodyCopy(markdown) {
      const problem = window.LLM.checkDraftForArticleUpdate(markdown);
      switch (problem) {
        case 'blank': return copy.reviewUpdateBodyBlank;
        case 'tooLong': return copy.reviewUpdateBodyTooLong.replace('{max}', String(window.LLM.ARTICLE_UPDATE_LIMITS.body));
        case 'hidden': return copy.reviewUpdateBodyHidden;
        case 'invisible': return copy.reviewUpdateBodyInvisible;
        case 'frontMatter': return copy.reviewUpdateBodyFrontMatter;
        default: return null;
      }
    }

    function collectUpdateInput(request) {
      const details = (request.answers || []).filter(({ input }) => input.value.trim())
        .map(({ aspect, input }) => ({ aspect, answer: input.value.trim() }));
      const notes = request.notesInput ? request.notesInput.value.trim() : '';
      return { details, notes };
    }

    function hasUpdateInput(request) {
      const { details, notes } = collectUpdateInput(request);
      return details.length > 0 || notes.length > 0;
    }

    function renderUpdateState(request) {
      if (!request.updateButton) return;
      if (request.updating) { request.updateButton.disabled = true; return; }
      const bodyProblem = updateBodyCopy(options.capture().story.markdown);
      if (bodyProblem) {
        request.updateButton.disabled = true;
        setUpdateStatus(request, bodyProblem, false, 'notice-warn');
      } else if (request.updatePromptInvalid) {
        request.updateButton.disabled = true;
        setUpdateStatus(request, copy.reviewUpdatePromptInvalid, false, 'notice-warn');
      } else if (!hasUpdateInput(request)) {
        request.updateButton.disabled = true;
        setUpdateStatus(request, copy.reviewUpdateNeedsAnswer, false);
      } else {
        request.updateButton.disabled = false;
      }
    }

    function onUpdateInput(request) {
      if (!request.applied) clearUpdatePreview(request);
      renderUpdateState(request);
    }

    function clearUpdatePreview(request) {
      if (request.previewContainer) request.previewContainer.replaceChildren();
      if (request.undoButton) { request.undoButton.remove(); request.undoButton = null; }
      request.applyButton = null;
      request.applied = false;
    }

    function disableUpdateInputs(request, disabled) {
      for (const { input } of request.answers || []) input.disabled = disabled;
      if (request.notesInput) request.notesInput.disabled = disabled;
    }

    function disableTitleExcerptApply(disabled) {
      for (const button of semantic.querySelectorAll('[data-review-action="title"], [data-review-action="excerpt"]')) {
        button.disabled = disabled;
      }
    }

    function setUpdating(request, on) {
      request.updating = on;
      runButton.disabled = on;
      disableUpdateInputs(request, on);
      disableTitleExcerptApply(on);
      if (request.cancelButton) {
        request.cancelButton.hidden = !on;
        if (on) request.cancelButton.focus({ preventScroll: true });
      }
      if (on) request.updateButton.disabled = true;
      else renderUpdateState(request);
    }

    function discloseUpdate(request, prepared) {
      request.disclosure.textContent = copy.reviewUpdateDisclosure
        .replace('{provider}', providerName(prepared.provider))
        .replace('{endpoint}', prepared.endpoint)
        .replace('{model}', prepared.model);
    }

    function updateSnapshotStale(request) {
      const current = options.capture();
      const sent = request.updateSnapshot;
      return current.identity !== sent.identity ||
        current.story.locale !== sent.story.locale ||
        current.story.title !== sent.story.title ||
        current.story.excerpt !== sent.story.excerpt ||
        current.story.markdown !== sent.story.markdown;
    }

    async function update(request) {
      clearUpdatePreview(request);
      request.updatePromptInvalid = false;
      const current = options.capture();
      const { details, notes } = collectUpdateInput(request);
      if ((!details.length && !notes) || updateBodyCopy(current.story.markdown)) {
        renderUpdateState(request);
        return;
      }
      const updateController = new AbortController();
      request.updateController = updateController;
      const onRequestAbort = () => updateController.abort();
      request.controller.signal.addEventListener('abort', onRequestAbort, { once: true });
      setUpdating(request, true);
      setUpdateStatus(request, copy.reviewUpdateRunning, true);
      let config = null;
      let apiKey = null;
      try {
        const response = await fetch('/ai-config', { cache: 'no-store', signal: updateController.signal });
        if (!owns(request)) return;
        if (response.status === 401) { invalidate(); options.on401(); return; }
        if (!response.ok) { setUpdateStatus(request, copy.reviewUpdateFailed, false, 'notice-warn'); return; }
        config = await response.json();
        if (!owns(request)) return;
        const prepared = describe(config);
        if (!prepared) { setUpdateStatus(request, copy.reviewUpdateFailed, false, 'notice-warn'); return; }
        if (!window.LLM.isReviewUpdatePrompt(config.reviewUpdatePrompt)) {
          request.updatePromptInvalid = true;
          setUpdateStatus(request, copy.reviewUpdatePromptInvalid, false, 'notice-warn');
          return;
        }
        const consentKey = JSON.stringify(prepared);
        if (!request.prepared || JSON.stringify(request.prepared) !== consentKey) {
          request.prepared = prepared;
          discloseUpdate(request, prepared);
          setUpdateStatus(request, copy.reviewUpdateConfigChanged, false, 'notice-warn');
          return;
        }
        apiKey = config.aiApiKey;
        config.aiApiKey = null;
        request.updateSnapshot = current;
        request.cancelButton.hidden = false;
        request.cancelButton.focus({ preventScroll: true });
        setUpdateStatus(request, copy.reviewUpdateRunning, true);
        const result = await window.LLM.updateArticlePracticalDetails({
          baseUrl: config.aiBaseUrl,
          model: config.aiModel,
          prompt: config.reviewUpdatePrompt,
          story: { locale: current.story.locale, title: current.story.title, excerpt: current.story.excerpt, markdown: current.story.markdown },
          practicalDetails: details,
          additionalNotes: notes,
          apiKey,
          timeoutMs: config.reviewTimeoutMs,
          signal: updateController.signal,
        });
        if (!owns(request)) return;
        if (updateController.signal.aborted) return;
        if (updateSnapshotStale(request)) {
          setUpdateStatus(request, copy.reviewUpdateStale, false, 'notice-warn');
          return;
        }
        const updated = window.LLM.normalizeArticleMarkdown(result.markdown);
        const original = window.LLM.normalizeArticleMarkdown(request.updateSnapshot.story.markdown);
        if (updated === original) {
          setUpdateStatus(request, copy.reviewUpdateNoChanges, false);
          return;
        }
        renderUpdatePreview(request, original, updated);
      } catch (error) {
        if (!owns(request)) return;
        if (error.name === 'AbortError') {
          setUpdateStatus(request, copy.reviewUpdateCancelled, false);
        } else if (error.name === 'TimeoutError') {
          setUpdateStatus(request, copy.reviewUpdateTimedOut, false, 'notice-warn');
        } else if (error.message === 'Article update HTTP 401') {
          invalidate(); options.on401(); return;
        } else if (error.message === 'Article update HTTP 403') {
          setUpdateStatus(request, copy.reviewUpdateAuthentication, false, 'notice-warn');
        } else if (error.message === 'Article update changed protected structure') {
          setUpdateStatus(request, copy.reviewUpdateStructureRejected, false, 'notice-warn');
        } else if (['Invalid article update response', 'Article update response was truncated', 'Article update response was incomplete', 'Article update response exceeded limit'].includes(error.message)) {
          setUpdateStatus(request, copy.reviewUpdateIncomplete, false, 'notice-warn');
        } else {
          setUpdateStatus(request, copy.reviewUpdateFailed, false, 'notice-warn');
        }
      } finally {
        request.controller.signal.removeEventListener('abort', onRequestAbort);
        if (config && typeof config === 'object') {
          config.aiApiKey = null;
          config.captionApiKey = null;
        }
        apiKey = null;
        config = null;
        request.updateController = null;
        if (owns(request)) setUpdating(request, false);
      }
    }

    function cancelUpdate(request) {
      if (!request.updateController) return;
      request.updateController.abort();
      setUpdating(request, false);
      setUpdateStatus(request, copy.reviewUpdateCancelled, false);
      request.updateButton.focus({ preventScroll: true });
    }

    function diffLines(original, updated) {
      const a = original.split('\n');
      const b = updated.split('\n');
      let start = 0;
      while (start < a.length && start < b.length && a[start] === b[start]) start++;
      let endA = a.length;
      let endB = b.length;
      while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
      const out = [];
      for (let i = 0; i < start; i++) out.push({ value: a[i], added: false, removed: false });
      for (const op of lcsOps(a.slice(start, endA), b.slice(start, endB))) out.push(op);
      for (let i = endA; i < a.length; i++) out.push({ value: a[i], added: false, removed: false });
      return out;
    }

    function lcsOps(a, b) {
      if (!a.length) return b.map((value) => ({ value, added: true, removed: false }));
      if (!b.length) return a.map((value) => ({ value, added: false, removed: true }));
      if (a.length * b.length > 4_000_000) {
        return [
          ...a.map((value) => ({ value, added: false, removed: true })),
          ...b.map((value) => ({ value, added: true, removed: false })),
        ];
      }
      const width = b.length + 1;
      const dp = new Int32Array((a.length + 1) * width);
      const idx = (i, j) => i * width + j;
      for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
          dp[idx(i, j)] = a[i] === b[j] ? dp[idx(i + 1, j + 1)] + 1 : Math.max(dp[idx(i + 1, j)], dp[idx(i, j + 1)]);
        }
      }
      const out = [];
      let i = 0;
      let j = 0;
      while (i < a.length && j < b.length) {
        if (a[i] === b[j]) { out.push({ value: a[i], added: false, removed: false }); i++; j++; }
        else if (dp[idx(i + 1, j)] >= dp[idx(i, j + 1)]) { out.push({ value: a[i], added: false, removed: true }); i++; }
        else { out.push({ value: b[j], added: true, removed: false }); j++; }
      }
      while (i < a.length) { out.push({ value: a[i], added: false, removed: true }); i++; }
      while (j < b.length) { out.push({ value: b[j], added: true, removed: false }); j++; }
      return out;
    }

    function renderUpdatePreview(request, original, updated) {
      request.previewContainer.replaceChildren();
      const lines = diffLines(original, updated);
      let added = 0;
      let removed = 0;
      let addedChars = 0;
      let removedChars = 0;
      for (const line of lines) {
        if (line.added) { added++; addedChars += line.value.length; }
        else if (line.removed) { removed++; removedChars += line.value.length; }
      }
      const delta = updated.length - original.length;
      request.previewContainer.appendChild(element('p', 'review-update-diff__summary', copy.reviewUpdateDiffSummary
        .replace('{added}', String(added)).replace('{removed}', String(removed))
        .replace('{addedChars}', String(addedChars)).replace('{removedChars}', String(removedChars))
        .replace('{delta}', (delta >= 0 ? '+' : '') + delta)));
      if (removed > 0 || updated.length < original.length) {
        request.previewContainer.appendChild(element('p', 'notice-warn review-update-diff__warning', copy.reviewUpdateShrinkWarning));
      }
      const diff = element('pre', 'review-update-diff');
      diff.setAttribute('aria-label', copy.reviewUpdateDiffLabel);
      for (const line of lines) {
        diff.appendChild(element('span', 'review-update-diff__line review-update-diff__line--' +
          (line.added ? 'added' : line.removed ? 'removed' : 'context'),
          (line.added ? '+ ' : line.removed ? '- ' : '  ') + line.value));
      }
      request.previewContainer.appendChild(diff);
      const previewLabel = element('label', 'review-notes__label', copy.reviewUpdatePreviewLabel);
      previewLabel.setAttribute('for', 'review-update-preview-' + request.epoch);
      const preview = element('textarea', 'review-update-preview__body article-translation__source');
      preview.id = 'review-update-preview-' + request.epoch;
      preview.setAttribute('rows', '12');
      preview.readOnly = true;
      preview.value = updated;
      request.previewContainer.appendChild(previewLabel);
      request.previewContainer.appendChild(preview);
      const apply = element('button', 'btn-secondary', copy.reviewUpdateApply);
      apply.type = 'button';
      apply.dataset.reviewAction = 'applyMarkdown';
      apply.addEventListener('click', () => applyMarkdown(request, updated));
      request.previewContainer.appendChild(apply);
      request.applyButton = apply;
      setUpdateStatus(request, copy.reviewUpdateReady, false);
      renderUpdateState(request);
    }

    function applyMarkdown(request, updated) {
      if (!owns(request) || !request.updateSnapshot) return;
      const current = options.capture();
      if (current.identity !== request.updateSnapshot.identity ||
          current.story.locale !== request.updateSnapshot.story.locale ||
          current.story.markdown !== request.updateSnapshot.story.markdown) {
        request.applyButton.disabled = true;
        setUpdateStatus(request, copy.reviewUpdateApplyStale, false, 'notice-warn');
        return;
      }
      applying = true;
      try {
        options.apply(request.updateSnapshot.story.locale, 'markdown', updated);
      } finally {
        applying = false;
      }
      if (!owns(request)) return;
      request.applied = true;
      request.applyButton.disabled = true;
      request.applyButton.textContent = copy.reviewUpdateApplied;
      setUpdateStatus(request, copy.reviewUpdateAppliedStatus, false);
      void renderInstant(request, options.capture().story);
      if (request.undoButton) { request.undoButton.remove(); request.undoButton = null; }
      const undo = element('button', 'btn-secondary', copy.reviewUpdateUndo);
      undo.type = 'button';
      undo.dataset.reviewAction = 'undoMarkdown';
      undo.addEventListener('click', () => undoMarkdown(request, updated));
      request.previewContainer.appendChild(undo);
      request.undoButton = undo;
    }

    function undoMarkdown(request, updated) {
      if (!owns(request) || !request.updateSnapshot) return;
      const current = options.capture();
      if (current.story.markdown !== updated) {
        request.undoButton.disabled = true;
        setUpdateStatus(request, copy.reviewUpdateUndoUnavailable, false, 'notice-warn');
        return;
      }
      applying = true;
      try {
        options.apply(request.updateSnapshot.story.locale, 'markdown', request.updateSnapshot.story.markdown);
      } finally {
        applying = false;
      }
      if (!owns(request)) return;
      request.applied = false;
      request.undoButton.disabled = true;
      if (request.applyButton) {
        request.applyButton.disabled = false;
        request.applyButton.textContent = copy.reviewUpdateApply;
      }
      setUpdateStatus(request, copy.reviewUpdateUndone, false);
      void renderInstant(request, options.capture().story);
    }

    function describe(config) {
      if (!config || !['lm-studio', 'openrouter', 'deepseek', 'anthropic', 'openai', 'custom'].includes(config.aiProvider) ||
          typeof config.aiBaseUrl !== 'string' || typeof config.aiModel !== 'string' ||
          !config.aiModel.trim() || typeof config.reviewPrompt !== 'string') return null;
      let endpoint;
      try { endpoint = new URL(config.aiBaseUrl); } catch (_) { return null; }
      if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password ||
          endpoint.search || endpoint.hash) return null;
      return {
        provider: config.aiProvider, endpoint: config.aiBaseUrl, model: config.aiModel,
        prompt: config.reviewPrompt, updatePrompt: config.reviewUpdatePrompt ?? null,
        timeout: config.reviewTimeoutMs,
      };
    }

    function providerName(provider) {
      return { 'lm-studio': 'LM Studio', openrouter: 'OpenRouter', deepseek: 'DeepSeek', anthropic: 'Anthropic', openai: 'OpenAI', custom: copy.reviewCustom }[provider] || provider;
    }

    function disclose(prepared) {
      destination.textContent = copy.reviewDestination.replace('{provider}', providerName(prepared.provider))
        .replace('{endpoint}', prepared.endpoint).replace('{model}', prepared.model);
      destination.hidden = false;
      runButton.textContent = copy.reviewStart;
      runButton.disabled = false;
    }

    async function review(request, approved) {
      let config = null;
      let apiKey = null;
      let configured = false;
      try {
        const response = await fetch('/ai-config', { cache: 'no-store', signal: request.controller.signal });
        if (!owns(request)) return;
        if (response.status === 401) {
          invalidate();
          options.on401();
          return;
        }
        if (!response.ok) {
          unavailable(copy.reviewConfigFailed, true);
          return;
        }
        config = await response.json();
        if (!owns(request)) return;
        const prepared = describe(config);
        if (!prepared) {
          unavailable('AI review needs a valid provider, endpoint and model in AI settings. Quick checks are still available.', true);
          return;
        }
        if (['openrouter', 'deepseek', 'anthropic', 'openai'].includes(config.aiProvider) && (typeof config.aiApiKey !== 'string' || !config.aiApiKey.trim())) {
          unavailable(copy.reviewMissingKey, true);
          return;
        }
        // Retain only disclosure metadata while waiting for consent. Fetch a fresh
        // bound config/key pair on the explicit action; changed destinations need
        // new consent rather than silently using the newly configured provider.
        request.prepared = prepared;
        disclose(prepared);
        if (!approved || JSON.stringify(approved) !== JSON.stringify(prepared)) {
          say(approved ? copy.reviewChanged : copy.reviewReady, false);
          return;
        }
        apiKey = config.aiApiKey;
        config.aiApiKey = null;
        configured = true;
        say('Reviewing this draft with the configured model… Quick checks are ready below their headings.', true);
        const result = await window.LLM.reviewStory(config.aiBaseUrl, config.aiModel, config.reviewPrompt,
          request.snapshot.story, apiKey, config.reviewTimeoutMs, request.controller.signal);
        if (!owns(request)) return;
        renderSemantic(request, result);
        say('Editorial review complete. Apply only the suggestions you want; nothing has been saved.', false);
      } catch (error) {
        if (!owns(request)) return;
        // Never display arbitrary provider/config errors: they can echo a draft
        // or a credential. The client exposes these fixed failure categories.
        if (!configured) {
          unavailable(copy.reviewConfigUnavailable, true);
        } else if (error.name === 'TimeoutError') {
          unavailable(copy.reviewTimedOut, false);
        } else if (error.message === 'Editorial review HTTP 401' || error.message === 'Editorial review HTTP 403') {
          unavailable(copy.reviewAuthentication, true);
        } else if (error.message === 'Invalid editorial review response' || error.message === 'Editorial review response was truncated') {
          unavailable(copy.reviewIncomplete, true);
        } else {
          unavailable(copy.reviewFailed, true);
        }
      } finally {
        if (config && typeof config === 'object') {
          config.aiApiKey = null;
          config.captionApiKey = null;
        }
        apiKey = null;
        config = null;
      }
    }

    function begin(approved) {
      release();
      clearResults();
      const request = { epoch, controller: new AbortController(), snapshot: options.capture(), prepared: null };
      active = request;
      byId('reviewLocale').textContent = request.snapshot.story.locale === 'de' ? 'Deutsch · DE' : 'English · EN';
      if (!dialog.open) dialog.showModal();
      void renderInstant(request);
      dialog.querySelector('.story-review__body').scrollTop = 0;
      say(copy.reviewPreparing, true);
      closeButton.focus();
      void review(request, approved);
    }

    function open() { begin(null); }

    trigger.addEventListener('click', open);
    runButton.addEventListener('click', () => {
      if (!runButton.disabled) begin(active?.prepared || null);
    });
    closeButton.addEventListener('click', () => close(true));
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(true); });
    dialog.addEventListener('close', () => {
      if (queuedCloseEvents) { queuedCloseEvents--; return; }
      if (!dialog.open) { release(); clearResults(); focusTrigger(); }
    });
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
      if (event.key !== 'Tab') return;
      // Recompute on each Tab: suggestions and settings links arrive async.
      const controls = Array.from(dialog.querySelectorAll('button, a[href], input, select, textarea, [tabindex]'))
        .filter((node) => !node.disabled && node.tabIndex >= 0 && !node.closest('[hidden]'));
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (!controls.includes(document.activeElement) || (event.shiftKey && document.activeElement === first) ||
          (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    });

    return { open, invalidate };
  }

  return { create };
})();
