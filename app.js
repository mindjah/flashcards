(function () {
  "use strict";

  var STORAGE_KEY = "esCards";
  var BOX_INTERVALS_DAYS = [0, 1, 3, 7, 16, 35]; // index = box number, box0 = due immediately
  var MAX_BOX = BOX_INTERVALS_DAYS.length - 1;

  var SECTION_COLORS = [
    "#f1bf00", "#3ecf8e", "#ff6b6b", "#5b8def", "#c77dff",
    "#ff9f45", "#38d9d9", "#f06595", "#82c91e", "#748ffc",
    "#ffa8a8", "#63e6be"
  ];

  function randomSectionColor() {
    return SECTION_COLORS[Math.floor(Math.random() * SECTION_COLORS.length)];
  }

  // Liquid-glass deck tinting needs each deck's own color as an rgba()
  // triplet (for the translucent background/glow), not just a flat hex
  // border color - deckTintStyle feeds a per-element --tint-rgb custom
  // property that the .deck-tinted CSS class reads.
  function hexToRgbTriplet(hex) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return "255, 255, 255";
    return parseInt(m[1], 16) + ", " + parseInt(m[2], 16) + ", " + parseInt(m[3], 16);
  }

  function applyDeckTint(el, hex) {
    el.classList.add("deck-tinted");
    el.style.setProperty("--tint-rgb", hexToRgbTriplet(hex));
  }

  // ---------- storage ----------
  function defaultStreak() {
    return { current: 0, lastDate: null };
  }

  function loadData() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { cards: [], sections: [], streak: defaultStreak(), lastExportAt: null, lastStudyPrefs: null, notepad: "" };
      var parsed = JSON.parse(raw);
      // migrate from the old format where the key held a bare cards array
      if (Array.isArray(parsed)) {
        parsed.forEach(function (c) {
          if (!Array.isArray(c.sectionIds)) c.sectionIds = [];
          if (typeof c.reviewed !== "boolean") c.reviewed = c.box > 0;
          if (c.box <= 0 && c.dueAt > Date.now()) c.dueAt = Date.now();
        });
        return { cards: parsed, sections: [], streak: defaultStreak(), lastExportAt: null, lastStudyPrefs: null, notepad: "" };
      }
      var loadedCards = Array.isArray(parsed.cards) ? parsed.cards : [];
      loadedCards.forEach(function (c) {
        if (!Array.isArray(c.sectionIds)) c.sectionIds = [];
        if (typeof c.reviewed !== "boolean") c.reviewed = c.box > 0;
        // A box-0 (New, never studied) card has no legitimate reason to
        // have a future due date in this app's own SRS model - only
        // graduating past box 0 earns one. Repairs imports (e.g. a
        // generated word list) that included one anyway, which would
        // otherwise silently never show up as due.
        if (c.box <= 0 && c.dueAt > Date.now()) c.dueAt = Date.now();
      });
      var loadedSections = Array.isArray(parsed.sections) ? parsed.sections : [];
      loadedSections.forEach(function (s) {
        if (!s.color) s.color = randomSectionColor();
      });
      var loadedStreak = parsed.streak && typeof parsed.streak.current === "number" ? parsed.streak : defaultStreak();
      return {
        cards: loadedCards,
        sections: loadedSections,
        streak: loadedStreak,
        lastExportAt: typeof parsed.lastExportAt === "number" ? parsed.lastExportAt : null,
        lastStudyPrefs: parsed.lastStudyPrefs && typeof parsed.lastStudyPrefs === "object" ? parsed.lastStudyPrefs : null,
        notepad: typeof parsed.notepad === "string" ? parsed.notepad : ""
      };
    } catch (e) {
      console.error("Failed to load data", e);
      return { cards: [], sections: [], streak: defaultStreak(), lastExportAt: null, lastStudyPrefs: null, notepad: "" };
    }
  }

  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      cards: cards,
      sections: sections,
      streak: streak,
      lastExportAt: lastExportAt,
      lastStudyPrefs: lastStudyPrefs,
      notepad: notepadText
    }));
  }

  var initialData = loadData();
  var cards = initialData.cards;
  var sections = initialData.sections;
  var streak = initialData.streak;
  var lastExportAt = initialData.lastExportAt;
  var lastStudyPrefs = initialData.lastStudyPrefs;
  var notepadText = initialData.notepad;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function isDue(card, now) {
    return card.dueAt <= now;
  }

  // ---------- streak ----------
  function pad2(n) { return n < 10 ? "0" + n : "" + n; }

  function dateStr(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function todayStr() { return dateStr(new Date()); }

  function yesterdayStr() {
    var d = new Date();
    d.setDate(d.getDate() - 1);
    return dateStr(d);
  }

  function recordStudyActivity() {
    var today = todayStr();
    if (streak.lastDate === today) return;
    streak.current = streak.lastDate === yesterdayStr() ? streak.current + 1 : 1;
    streak.lastDate = today;
    saveData();
  }

  // ---------- mastery ----------
  function masteryTier(c) {
    if (c.box <= 0) return "fresh";
    if (c.box <= 2) return "learning";
    return "mastered";
  }

  function masteryBreakdown() {
    var counts = { fresh: 0, learning: 0, mastered: 0 };
    cards.forEach(function (c) { counts[masteryTier(c)]++; });
    return counts;
  }

  function strugglingCards() {
    return cards
      .filter(function (c) { return c.box <= 0 && c.reviewed; })
      .sort(function (a, b) { return b.dueAt - a.dueAt; })
      .slice(0, 20);
  }

  // ---------- google translate ----------
  // Dispatches a real, synchronous <a> click (not window.open/location.href)
  // so the navigation carries full "trusted user gesture" status in WebKit -
  // translate.google.com is a Universal Link domain, and a standalone
  // home-screen PWA hands external navigation off to iOS's app-resolution
  // layer, which can otherwise leave a stray browsing-context window behind
  // that resurfaces over this app when you switch back to it.
  function openGoogleTranslate(text) {
    var trimmed = (text || "").trim();
    if (!trimmed) return;
    var query = encodeURIComponent(trimmed);
    var webUrl = "https://translate.google.com/?sl=es&tl=en&text=" + query + "&op=translate";

    var a = document.createElement("a");
    a.href = webUrl;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // ---------- sections ----------
  function sectionById(id) {
    return sections.find(function (s) { return s.id === id; });
  }

  function sectionNames(card) {
    return card.sectionIds
      .map(function (id) { var s = sectionById(id); return s ? s.name : null; })
      .filter(Boolean);
  }

  function sectionRefs(card) {
    return card.sectionIds
      .map(function (id) { return sectionById(id); })
      .filter(Boolean);
  }

  function addSection(name) {
    name = name.trim();
    if (!name) return null;
    var existing = sections.find(function (s) { return s.name.toLowerCase() === name.toLowerCase(); });
    if (existing) return existing;
    var section = { id: uid(), name: name, color: randomSectionColor(), createdAt: Date.now() };
    sections.push(section);
    saveData();
    return section;
  }

  function getOrCreateSectionByName(name) {
    name = name.trim();
    if (!name) return null;
    var existing = sections.find(function (s) { return s.name.toLowerCase() === name.toLowerCase(); });
    if (existing) return existing;
    var section = { id: uid(), name: name, color: randomSectionColor(), createdAt: Date.now() };
    sections.push(section);
    return section;
  }

  function renameSection(id, newName) {
    var s = sectionById(id);
    if (!s) return;
    s.name = newName.trim();
    saveData();
  }

  function deleteSection(id) {
    sections = sections.filter(function (s) { return s.id !== id; });
    cards.forEach(function (c) {
      c.sectionIds = c.sectionIds.filter(function (sid) { return sid !== id; });
    });
    saveData();
  }

  // ---------- filtering ----------
  // filter: null/undefined = no filtering (all cards).
  // otherwise { ids: Set<sectionId>, includeUnsectioned: bool }
  function matchesFilter(card, filter) {
    if (!filter) return true;
    if (card.sectionIds.length === 0) return filter.includeUnsectioned;
    return card.sectionIds.some(function (id) { return filter.ids.has(id); });
  }

  function dueCards(filter) {
    var now = Date.now();
    return cards.filter(function (c) { return isDue(c, now) && matchesFilter(c, filter); });
  }

  // ---------- view management ----------
  var views = {
    home: document.getElementById("view-home"),
    study: document.getElementById("view-study"),
    studySetup: document.getElementById("view-study-setup"),
    empty: document.getElementById("view-empty"),
    add: document.getElementById("view-add"),
    manage: document.getElementById("view-manage"),
    sections: document.getElementById("view-sections"),
    readme: document.getElementById("view-readme"),
    changelog: document.getElementById("view-changelog"),
    gemini: document.getElementById("view-gemini"),
    notes: document.getElementById("view-notes")
  };

  var TABBAR_VIEWS = { home: true, manage: true, sections: true, notes: true };

  function showView(name) {
    Object.keys(views).forEach(function (k) {
      views[k].classList.toggle("hidden", k !== name);
    });
    if (name === "home") celebrateStreakOnHomeLanding();
    updateTabbar(name);
  }

  // ---------- bottom tab bar ----------
  var tabbar = document.getElementById("bottom-tabbar");
  var tabbarIndicator = document.getElementById("tabbar-indicator");
  var tabbarButtons = Array.prototype.slice.call(tabbar.querySelectorAll(".tab-btn"));

  function placeTabbarIndicator(animated) {
    var active = tabbar.querySelector(".tab-btn.active");
    if (!active) return;
    var barRect = tabbar.getBoundingClientRect();
    var rect = active.getBoundingClientRect();
    var x = rect.left - barRect.left + (rect.width - tabbarIndicator.offsetWidth) / 2;
    if (!animated) tabbarIndicator.style.transition = "none";
    tabbarIndicator.style.transform = "translateX(" + x + "px)";
    if (!animated) {
      requestAnimationFrame(function () { tabbarIndicator.style.transition = ""; });
    }
  }

  function updateTabbar(name) {
    var show = !!TABBAR_VIEWS[name];
    tabbar.classList.toggle("hidden", !show);
    if (!show) return;
    tabbarButtons.forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.view === name);
    });
    placeTabbarIndicator(false);
  }

  tabbarButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var view = btn.dataset.view;
      var alreadyActive = btn.classList.contains("active");
      if (view === "home") { refreshHome(); showView("home"); }
      else if (view === "practice") { renderStudySetup(); showView("studySetup"); }
      else if (view === "manage") {
        if (alreadyActive) {
          document.getElementById("manage-list").scrollTo({ top: 0, behavior: "smooth" });
        } else {
          openManageView();
        }
      } else if (view === "sections") {
        if (alreadyActive) {
          document.getElementById("sections-list").scrollTo({ top: 0, behavior: "smooth" });
        } else {
          openSectionsView();
        }
      } else if (view === "notes") { openNotesView(); }
    });
  });

  window.addEventListener("resize", function () { placeTabbarIndicator(false); });

  // ---------- home ----------
  // Generic small info popup, positioned dynamically off whichever element
  // triggered it (stat cards are fixed in place; hint-row words scroll, so
  // this can't just be anchored via CSS like the settings dropdown is).
  var infoPopupAnchor = null;

  function showInfoPopup(anchorEl, text) {
    var popup = document.getElementById("stat-info-popup");
    if (!popup.classList.contains("hidden") && infoPopupAnchor === anchorEl) {
      hideInfoPopup();
      return;
    }
    document.getElementById("stat-info-text").textContent = text;
    popup.classList.remove("hidden");
    infoPopupAnchor = anchorEl;

    var margin = 16;
    var anchorRect = anchorEl.getBoundingClientRect();
    var popupRect = popup.getBoundingClientRect();

    var left = anchorRect.left + anchorRect.width / 2 - popupRect.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - popupRect.width - margin));

    var top = anchorRect.bottom + 8;
    if (top + popupRect.height + margin > window.innerHeight) {
      top = anchorRect.top - popupRect.height - 8;
    }

    popup.style.left = left + "px";
    popup.style.top = top + "px";
  }

  function hideInfoPopup() {
    document.getElementById("stat-info-popup").classList.add("hidden");
    infoPopupAnchor = null;
    if (activeRevealIcon) {
      setRevealIcon(activeRevealIcon, false);
      activeRevealIcon = null;
    }
  }

  var STAT_INFO = {
    "stat-card-due": "To learn: cards that are due for review right now - new cards plus any whose review interval has passed. Tap Practice to work through them.",
    "stat-card-total": "Total cards: every card in your collection, across all card decks.",
    "stat-card-streak": "Day streak: consecutive days you've practiced at least one card. Practice today to keep it going."
  };

  Object.keys(STAT_INFO).forEach(function (cardId) {
    var el = document.getElementById(cardId);
    el.addEventListener("click", function () {
      showInfoPopup(el, STAT_INFO[cardId]);
    });
  });

  // ---------- streak flame burst ----------
  // If a burst is interrupted by navigating away mid-animation, display:none
  // cancels it without ever firing animationend, so the JS-side removal
  // never runs and the flame is stuck in the DOM. Clearing any leftover
  // particles before spawning a new batch (or on every home landing, even
  // when no new burst plays) keeps them from silently replaying and piling
  // up every time the home screen becomes visible again.
  function clearFlameParticles(anchorEl) {
    Array.prototype.slice.call(anchorEl.querySelectorAll(".flame-particle")).forEach(function (el) {
      el.remove();
    });
  }

  function spawnFlameBurst(anchorEl) {
    clearFlameParticles(anchorEl);
    var COUNT = 10;
    for (var i = 0; i < COUNT; i++) {
      var flame = document.createElement("span");
      flame.className = "flame-particle";
      flame.textContent = "🔥";

      var angle = Math.random() * Math.PI * 2;
      var distance = 35 + Math.random() * 45;
      var dx = Math.cos(angle) * distance;
      var dy = Math.sin(angle) * distance;
      var rot = (Math.random() - 0.5) * 140;
      var scale = 0.5 + Math.random() * 0.6;
      var duration = 500 + Math.random() * 300;

      flame.style.setProperty("--dx", dx + "px");
      flame.style.setProperty("--dy", dy + "px");
      flame.style.setProperty("--rot", rot + "deg");
      flame.style.setProperty("--scale", scale);
      flame.style.animationDuration = duration + "ms";

      flame.addEventListener("animationend", function () {
        flame.remove();
      });
      anchorEl.appendChild(flame);
    }
  }

  document.getElementById("stat-card-streak").addEventListener("click", function () {
    spawnFlameBurst(this);
  });

  function celebrateStreakOnHomeLanding() {
    var streakEl = document.getElementById("stat-card-streak");
    if (streak.lastDate === todayStr()) {
      spawnFlameBurst(streakEl);
    } else {
      clearFlameParticles(streakEl);
    }
  }

  document.addEventListener("click", function (e) {
    if (!document.getElementById("stat-info-popup").classList.contains("hidden") &&
        !e.target.closest("#stat-info-popup") &&
        !e.target.closest(".info-trigger")) {
      hideInfoPopup();
    }
  });

  document.getElementById("view-home").addEventListener("scroll", hideInfoPopup);
  document.getElementById("view-manage").addEventListener("scroll", hideInfoPopup);

  // ---------- card preview modal (flip-able, same size/style as Practice) ----------
  var cardPreviewModal = document.getElementById("card-preview-modal");
  var cardPreviewFlashcard = document.getElementById("card-preview-flashcard");

  function openCardPreview(c) {
    cardPreviewFlashcard.classList.remove("flipped");
    document.getElementById("card-preview-word").textContent = c.word;
    document.getElementById("card-preview-translation").textContent = c.translation;
    var noteEl = document.getElementById("card-preview-note");
    if (c.notes) {
      document.getElementById("card-preview-note-text").textContent = c.notes;
      noteEl.classList.remove("hidden");
    } else {
      noteEl.classList.add("hidden");
    }
    cardPreviewModal.classList.remove("hidden");
  }

  function closeCardPreview() {
    cardPreviewModal.classList.add("hidden");
  }

  cardPreviewFlashcard.addEventListener("click", function () {
    cardPreviewFlashcard.classList.toggle("flipped");
  });

  cardPreviewModal.addEventListener("click", function (e) {
    if (e.target === this) closeCardPreview();
  });

  // "To learn"/"Total cards" (now shown on the Manage screen) and the
  // streak (now a compact header button) are global counts unrelated to
  // Manage's own search/filters, so they're refreshed from both here and
  // openManageView() rather than only whenever the home screen updates.
  function updateGlobalStats() {
    document.getElementById("stat-due").textContent = dueCards().length;
    document.getElementById("stat-total").textContent = cards.length;
    document.getElementById("stat-streak").textContent = streak.current;
  }

  function refreshHome() {
    updateGlobalStats();

    var m = masteryBreakdown();
    var total = cards.length;
    setMasterySegment("mastery-new", m.fresh, total);
    setMasterySegment("mastery-learning", m.learning, total);
    setMasterySegment("mastery-mastered", m.mastered, total);
    document.getElementById("mastery-new-count").textContent = m.fresh;
    document.getElementById("mastery-learning-count").textContent = m.learning;
    document.getElementById("mastery-mastered-count").textContent = m.mastered;

    renderDailyCard();
    renderStrugglingList();
    document.getElementById("empty-home-placeholder").classList.toggle("hidden", cards.length > 0);
  }

  // ---------- daily card ----------
  // Picked once per calendar day and cached in localStorage (not just
  // re-rolled on every refreshHome call) so it stays the same word across
  // a whole day's worth of visits to the home screen.
  var DAILY_CARD_KEY = "esDailyCard";
  var lastDailyCardId = null;

  function pickDailyCard() {
    if (cards.length === 0) return null;
    var today = todayStr();
    var stored = null;
    try { stored = JSON.parse(localStorage.getItem(DAILY_CARD_KEY)); } catch (e) {}
    if (stored && stored.date === today) {
      var found = cards.filter(function (c) { return c.id === stored.id; })[0];
      if (found) return found;
    }
    var pick = cards[Math.floor(Math.random() * cards.length)];
    localStorage.setItem(DAILY_CARD_KEY, JSON.stringify({ date: today, id: pick.id }));
    return pick;
  }

  function renderDailyCard() {
    var el = document.getElementById("daily-card");
    var card = pickDailyCard();
    if (!card) {
      el.classList.add("hidden");
      lastDailyCardId = null;
      return;
    }
    el.classList.remove("hidden");
    if (card.id === lastDailyCardId) return; // already showing this card - don't reset its flip state
    lastDailyCardId = card.id;
    el.classList.remove("flipped");
    document.getElementById("daily-card-word").textContent = card.word;
    document.getElementById("daily-card-translation").textContent = card.translation;
    var noteEl = document.getElementById("daily-card-note");
    if (card.notes) {
      document.getElementById("daily-card-note-text").textContent = card.notes;
      noteEl.classList.remove("hidden");
    } else {
      noteEl.classList.add("hidden");
    }
  }

  document.getElementById("daily-card-inner").addEventListener("click", function () {
    document.getElementById("daily-card").classList.toggle("flipped");
  });

  // Same open/slashed-eye glyphs used by password fields' show/hide toggle -
  // here they mark whether this row's translation popup is currently open.
  var EYE_ICON_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_ICON_CLOSED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  var activeRevealIcon = null;

  function setRevealIcon(el, open) {
    el.innerHTML = open ? EYE_ICON_OPEN : EYE_ICON_CLOSED;
    el.classList.toggle("is-open", open);
  }

  function buildHintRow(c) {
    var item = document.createElement("button");
    item.type = "button";
    item.className = "struggling-item info-trigger";

    var word = document.createElement("span");
    word.className = "struggling-item-word";
    word.textContent = c.word;

    var right = document.createElement("span");
    right.className = "struggling-item-right";

    var revealIcon = document.createElement("span");
    revealIcon.className = "struggling-item-icon";
    setRevealIcon(revealIcon, false);
    right.appendChild(revealIcon);

    item.appendChild(word);
    item.appendChild(right);

    item.addEventListener("click", function () {
      openCardPreview(c);
    });

    return item;
  }

  function recentlyAddedCards() {
    return cards.slice().sort(function (a, b) { return b.createdAt - a.createdAt; }).slice(0, 20);
  }

  var HINT_COLLAPSED_COUNT = 3;
  var HINT_SHOW_MORE_THRESHOLD = 6;
  var strugglingExpanded = false;
  var recentExpanded = false;

  function renderHintSection(listId, toggleId, items, expanded) {
    var list = document.getElementById(listId);
    list.innerHTML = "";
    items.slice(0, expanded ? 20 : HINT_COLLAPSED_COUNT).forEach(function (c) {
      list.appendChild(buildHintRow(c));
    });

    var toggle = document.getElementById(toggleId);
    toggle.classList.toggle("hidden", items.length <= HINT_SHOW_MORE_THRESHOLD);
    toggle.textContent = expanded ? "Show less" : "Show more";
  }

  function renderStrugglingList() {
    hideInfoPopup(); // rows are rebuilt below - don't leave a stale-anchored popup on screen
    var struggling = strugglingCards();
    var showStruggling = struggling.length > 0;

    document.getElementById("struggling-block").classList.toggle("hidden", !showStruggling);

    // Only one of these two hint sections shows at a time - recently added
    // cards fill the space when nothing is currently struggling.
    if (showStruggling) {
      renderHintSection("struggling-list", "struggling-toggle", struggling, strugglingExpanded);
      document.getElementById("recent-block").classList.add("hidden");
      return;
    }

    var recent = recentlyAddedCards();
    document.getElementById("recent-block").classList.toggle("hidden", recent.length === 0);
    renderHintSection("recent-list", "recent-toggle", recent, recentExpanded);
  }

  // Keeps the toggle button itself - "Show less" once expanded, "Show
  // more" again once collapsed - clear of the floating tab bar rather
  // than scrolling to the top of the block, which left an expanded
  // list's toggle far below the fold with no automatic way to reach it.
  // Uses the browser's own scrollIntoView + scroll-margin-bottom (see
  // styles.css) instead of a hand-computed scrollBy delta, which wasn't
  // reliably landing on a real device despite matching the math in
  // every automated test.
  function scrollToggleAboveTabbar(toggleId) {
    document.getElementById(toggleId).scrollIntoView({ behavior: "smooth", block: "end" });
  }

  document.getElementById("struggling-toggle").addEventListener("click", function () {
    strugglingExpanded = !strugglingExpanded;
    renderStrugglingList();
    scrollToggleAboveTabbar("struggling-toggle");
  });

  document.getElementById("recent-toggle").addEventListener("click", function () {
    recentExpanded = !recentExpanded;
    renderStrugglingList();
    scrollToggleAboveTabbar("recent-toggle");
  });

  function setMasterySegment(id, count, total) {
    var el = document.getElementById(id);
    el.classList.toggle("hidden", count === 0);
    el.style.flexBasis = total > 0 ? (count / total * 100) + "%" : "0%";
  }

  var manageReturnTo = "home";

  function openManageView() {
    manageReturnTo = "home";
    updateGlobalStats();
    populateManageSectionFilter();
    document.getElementById("manage-section-filter").value = "";
    document.getElementById("manage-mastery-filter").value = "";
    manageSelectMode = false;
    manageSelectedIds.clear();
    updateManageSelectUI();
    renderManageList();
    showView("manage");
  }

  function openManageForSection(sectionId) {
    manageReturnTo = "sections";
    updateGlobalStats();
    populateManageSectionFilter();
    document.getElementById("manage-section-filter").value = sectionId;
    document.getElementById("manage-mastery-filter").value = "";
    document.getElementById("manage-search").value = "";
    manageSelectMode = false;
    manageSelectedIds.clear();
    updateManageSelectUI();
    renderManageList();
    showView("manage");
  }

  function openSectionsView() {
    renderSectionsList();
    showView("sections");
  }

  document.getElementById("btn-readme").addEventListener("click", function () {
    showView("readme");
  });

  document.getElementById("btn-readme-back").addEventListener("click", function () {
    refreshHome();
    showView("home");
  });

  // ---------- change log ----------
  // Newest first - prepend a new entry (and drop the last one, if you want
  // to hold the list at 10) each time a version ships with user-facing
  // changes worth calling out.
  var CHANGELOG = [
    { version: "1.22.1", text: "Fixed a bug from the swipe-to-reveal change that deleted CSS Card decks still needed, making its rows resize/reflow badly. Also fixed Manage cards rows going invisible on some devices (visible only in Select mode) by making the swipe layout's widths explicit rather than relying on implicit flex sizing, and fixed + Add card wrapping onto two lines." },
    { version: "1.21.0", text: "Reworked the tab bar: swapped the Cards/Decks icons, renamed Manage to Cards, moved Practice to the center, and added a new Notes tab (a freeform notepad that exports/imports alongside your cards). Add card no longer has its own tab - use \"+ Add card\" in Manage cards instead, which also gained a Delete card option when editing. Added spacing above the Practice progress bar, and the finished-session screen is now a square card with a matching-width Back home button and no close button." },
    { version: "1.20.0", text: "Moved Practice off the home screen and into the tab bar as its own filled button, right next to Home - Card of the day now expands to fill the freed space. Also darkened the backdrop behind the card preview modal (Manage cards / home lists) so it reads as solid glass instead of looking washed out." },
    { version: "1.19.4", text: "Send request now opens Gemini via a new tab again - iOS always routes an external link tapped from a home-screen app through its own in-app browser sheet no matter how it's opened, so this at least leaves the app's own window untouched underneath. Use that sheet's Safari icon to fully open Gemini in the real browser." },
    { version: "1.19.2", text: "Ask Gemini's requested notes now include pronunciation and an example sentence for each word, not just a translation. Trimmed the Ask Gemini screen's instructions to just the download-and-import step." },
    { version: "1.19.1", text: "Fixed Ask Gemini not actually prefilling the prompt - Gemini's web app has no URL prefill, so Send request now copies the prompt to your clipboard instead (paste it into Gemini yourself). The prompt now also asks Gemini to generate an actual downloadable .txt file rather than just chat text, so there's no more manual copy-paste-into-a-file step. Also moved Save card above the Gemini button in Add card, with more spacing after Card decks." },
    { version: "1.19.0", text: "Added \"Ask Gemini to create a deck\" in Add card - fill in a theme, word count, language and deck name and it opens Gemini with a ready-made prompt to generate an importable word list. Importing a file now only adopts its saved streak if your current streak is 0, so it can't overwrite one you're already building." },
    { version: "1.18.0", text: "Card decks now have a true liquid-glass look (gradient + glow, not just a flat tint). Added this Change log to Settings, and refreshed the README to match current features." },
    { version: "1.17.0", text: "Missing a card now brings it back after at least 10 other cards; missing it a second time sets it aside for a review pass at the end of the session. You can also edit a card right from its flipped practice view, then pick up the lesson exactly where you left off." },
    { version: "1.16.0", text: "Deck colors now fill the whole chip/row background instead of just outlining it. Tapping a card in Manage cards or on the home lists opens a flip-able preview - same size and style as practice - instead of a plain text popup." }
  ];

  function renderChangelog() {
    var content = document.getElementById("changelog-content");
    content.innerHTML = "";
    CHANGELOG.slice(0, 10).forEach(function (entry) {
      var section = document.createElement("div");
      section.className = "readme-section";
      var h3 = document.createElement("h3");
      h3.textContent = "v" + entry.version;
      var p = document.createElement("p");
      p.textContent = entry.text;
      section.appendChild(h3);
      section.appendChild(p);
      content.appendChild(section);
    });
  }

  document.getElementById("btn-changelog").addEventListener("click", function () {
    renderChangelog();
    showView("changelog");
  });

  document.getElementById("btn-changelog-back").addEventListener("click", function () {
    refreshHome();
    showView("home");
  });

  // ---------- notes ----------
  function openNotesView() {
    document.getElementById("notes-textarea").value = notepadText;
    showView("notes");
  }

  document.getElementById("notes-textarea").addEventListener("input", function () {
    notepadText = this.value;
    saveData();
  });

  document.getElementById("btn-notes-back").addEventListener("click", function () {
    refreshHome();
    showView("home");
  });

  // ---------- settings dropdown ----------
  document.getElementById("btn-settings").addEventListener("click", function () {
    document.getElementById("settings-menu").classList.toggle("hidden");
  });

  document.getElementById("settings-menu").addEventListener("click", function (e) {
    if (e.target.closest(".dropdown-item")) {
      document.getElementById("settings-menu").classList.add("hidden");
    }
  });

  document.addEventListener("click", function (e) {
    var dropdown = document.getElementById("settings-dropdown");
    if (!dropdown.contains(e.target)) {
      document.getElementById("settings-menu").classList.add("hidden");
    }
  });

  // ---------- flag icon easter egg ----------
  var flagAnimating = false;
  document.getElementById("flag-icon").addEventListener("click", function () {
    if (flagAnimating) return;
    flagAnimating = true;

    var flagEl = this;
    var rect = flagEl.getBoundingClientRect();
    var restLeft = rect.left, restTop = rect.top;
    var startFontSize = parseFloat(getComputedStyle(flagEl).fontSize);
    var centerX = rect.left + rect.width / 2;
    var centerY = rect.top + rect.height / 2;

    flagEl.style.visibility = "hidden";

    var clone = document.createElement("span");
    clone.textContent = flagEl.textContent;
    clone.className = "flag-flying";
    clone.style.fontSize = startFontSize + "px";
    clone.style.left = restLeft + "px";
    clone.style.top = restTop + "px";
    document.body.appendChild(clone);

    requestAnimationFrame(function () {
      clone.style.fontSize = (startFontSize * 5) + "px";
    });

    var angle = Math.random() * Math.PI * 2;
    var speed = 350;
    var vx = Math.cos(angle) * speed;
    var vy = Math.sin(angle) * speed;
    var rotation = 0;
    var rotationSpeed = (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 360);
    var x = restLeft, y = restTop;
    var startTime = null;
    var lastTime = null;
    var duration = 5000;

    function step(timestamp) {
      if (startTime === null) startTime = timestamp;
      if (lastTime === null) lastTime = timestamp;
      var dt = (timestamp - lastTime) / 1000;
      lastTime = timestamp;
      var elapsed = timestamp - startTime;

      var size = clone.getBoundingClientRect();
      var w = size.width, h = size.height;

      x += vx * dt;
      y += vy * dt;

      if (x <= 0) { x = 0; vx = Math.abs(vx); }
      if (x + w >= window.innerWidth) { x = window.innerWidth - w; vx = -Math.abs(vx); }
      if (y <= 0) { y = 0; vy = Math.abs(vy); }
      if (y + h >= window.innerHeight) { y = window.innerHeight - h; vy = -Math.abs(vy); }

      rotation += rotationSpeed * dt;

      clone.style.left = x + "px";
      clone.style.top = y + "px";
      clone.style.transform = "rotate(" + rotation + "deg)";

      if (elapsed < duration) {
        requestAnimationFrame(step);
      } else {
        clone.style.transition = "left 0.4s ease-in-out, top 0.4s ease-in-out, transform 0.4s ease-in-out, font-size 0.4s ease-in-out";
        clone.style.left = (centerX - rect.width / 2) + "px";
        clone.style.top = (centerY - rect.height / 2) + "px";
        clone.style.transform = "rotate(0deg)";
        clone.style.fontSize = startFontSize + "px";
        setTimeout(function () {
          clone.remove();
          flagEl.style.visibility = "";
          flagAnimating = false;
        }, 450);
      }
    }
    requestAnimationFrame(step);
  });

  // ---------- add / edit card ----------
  var editingId = null;
  var editingSectionIds = [];
  // Where to land after saving/cancelling an edit - "manage" (the default,
  // reached via Manage cards' Edit button) or "study", set when editing was
  // opened from the study card's edit icon so the session resumes exactly
  // where it left off instead of dropping into Manage cards.
  var addReturnTo = "manage";
  // Checkboxes only mutate this staged copy - editingSectionIds (what the
  // summary shows and what actually saves with the card) only picks up
  // the change once "Apply" is tapped, so closing the panel without
  // applying discards it.
  var stagedSectionIds = [];

  function renderAddSectionsPicker() {
    var list = document.getElementById("add-sections-list");
    list.innerHTML = "";

    sections.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (s) {
      var row = document.createElement("label");
      row.className = "deck-dropdown-row";
      applyDeckTint(row, s.color);

      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = stagedSectionIds.indexOf(s.id) !== -1;
      checkbox.addEventListener("change", function () {
        var idx = stagedSectionIds.indexOf(s.id);
        if (checkbox.checked && idx === -1) {
          stagedSectionIds.push(s.id);
        } else if (!checkbox.checked && idx !== -1) {
          stagedSectionIds.splice(idx, 1);
        }
        updateDeckDropdownApplyState();
      });

      var text = document.createElement("span");
      text.textContent = s.name;

      row.appendChild(checkbox);
      row.appendChild(text);
      list.appendChild(row);
    });

    updateDeckDropdownApplyState();
  }

  function updateDeckDropdownApplyState() {
    document.getElementById("deck-dropdown-apply").disabled = stagedSectionIds.length === 0;
  }

  function updateDeckDropdownSummary() {
    var summary = document.getElementById("deck-dropdown-summary");
    if (editingSectionIds.length === 0) {
      summary.textContent = "No card decks";
    } else {
      var names = editingSectionIds
        .map(function (id) { var s = sections.filter(function (x) { return x.id === id; })[0]; return s ? s.name : null; })
        .filter(Boolean);
      summary.textContent = names.join(", ");
    }
  }

  document.getElementById("deck-dropdown-trigger").addEventListener("click", function () {
    var panel = document.getElementById("deck-dropdown-panel");
    var opening = panel.classList.contains("hidden");
    if (opening) {
      stagedSectionIds = editingSectionIds.slice();
      renderAddSectionsPicker();
    }
    panel.classList.toggle("hidden");
  });

  document.getElementById("deck-dropdown-apply").addEventListener("click", function () {
    editingSectionIds = stagedSectionIds.slice();
    updateDeckDropdownSummary();
    document.getElementById("deck-dropdown-panel").classList.add("hidden");
  });

  document.getElementById("deck-dropdown-new").addEventListener("click", function () {
    openNewDeckModal("add");
  });

  // ---------- new card deck modal ----------
  // Shared by the "+ New card deck" action inside the Add/Edit card deck
  // picker and the "+ Add card deck" button on the Card decks screen -
  // newDeckContext says which list to refresh (and, for "add", which
  // card's deck selection to update) once a name is confirmed.
  var newDeckContext = null;

  function openNewDeckModal(context) {
    newDeckContext = context;
    var input = document.getElementById("new-deck-input");
    input.value = "";
    document.getElementById("new-deck-add").disabled = true;
    document.getElementById("new-deck-modal").classList.remove("hidden");
    input.focus();
  }

  function closeNewDeckModal() {
    document.getElementById("new-deck-modal").classList.add("hidden");
    newDeckContext = null;
  }

  document.getElementById("new-deck-input").addEventListener("input", function () {
    document.getElementById("new-deck-add").disabled = !this.value.trim();
  });

  document.getElementById("new-deck-input").addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !document.getElementById("new-deck-add").disabled) {
      document.getElementById("new-deck-add").click();
    }
  });

  document.getElementById("new-deck-cancel").addEventListener("click", closeNewDeckModal);

  document.getElementById("new-deck-modal").addEventListener("click", function (e) {
    if (e.target === this) closeNewDeckModal();
  });

  document.getElementById("new-deck-add").addEventListener("click", function () {
    var name = document.getElementById("new-deck-input").value.trim();
    if (!name) return;
    var section = addSection(name);
    if (newDeckContext === "add") {
      if (section && stagedSectionIds.indexOf(section.id) === -1) {
        stagedSectionIds.push(section.id);
      }
      renderAddSectionsPicker();
    } else if (newDeckContext === "sections") {
      renderSectionsList();
    }
    closeNewDeckModal();
  });

  document.addEventListener("click", function (e) {
    var dropdown = document.getElementById("deck-dropdown");
    if (!dropdown.contains(e.target)) {
      document.getElementById("deck-dropdown-panel").classList.add("hidden");
    }
  });

  function openAddView(cardToEdit) {
    var wordEl = document.getElementById("input-word");
    var transEl = document.getElementById("input-translation");
    var notesEl = document.getElementById("input-notes");
    var titleEl = document.getElementById("add-view-title");
    var saveBtn = document.getElementById("btn-save-card");

    if (cardToEdit) {
      editingId = cardToEdit.id;
      titleEl.textContent = "Edit card";
      saveBtn.textContent = "Save changes";
      wordEl.value = cardToEdit.word;
      transEl.value = cardToEdit.translation;
      notesEl.value = cardToEdit.notes || "";
      editingSectionIds = cardToEdit.sectionIds.slice();
    } else {
      editingId = null;
      titleEl.textContent = "Add card";
      saveBtn.textContent = "Save card";
      wordEl.value = "";
      transEl.value = "";
      notesEl.value = "";
      editingSectionIds = [];
    }

    stagedSectionIds = editingSectionIds.slice();
    renderAddSectionsPicker();
    updateDeckDropdownSummary();
    document.getElementById("deck-dropdown-panel").classList.add("hidden");
    document.getElementById("save-toast").classList.add("hidden");
    document.getElementById("btn-delete-card").classList.toggle("hidden", !cardToEdit);
    document.getElementById("btn-ask-gemini").classList.toggle("hidden", !!cardToEdit);
    updateSaveCardButtonState();
    showView("add");
    wordEl.focus();
  }

  document.getElementById("btn-delete-card").addEventListener("click", function () {
    if (!editingId) return;
    var target = cards.find(function (c) { return c.id === editingId; });
    if (!target || !confirm('Delete "' + target.word + '"?')) return;
    cards = cards.filter(function (c) { return c.id !== editingId; });
    saveData();
    updateGlobalStats();
    editingId = null;
    addReturnTo = "manage";
    renderManageList(document.getElementById("manage-search").value);
    showView("manage");
  });

  function updateSaveCardButtonState() {
    var word = document.getElementById("input-word").value.trim();
    var translation = document.getElementById("input-translation").value.trim();
    document.getElementById("btn-save-card").disabled = !(word && translation);
    document.getElementById("btn-add-translate").disabled = !word;
  }

  document.getElementById("input-word").addEventListener("input", updateSaveCardButtonState);
  document.getElementById("input-translation").addEventListener("input", updateSaveCardButtonState);

  document.getElementById("btn-add-translate").addEventListener("click", function () {
    openGoogleTranslate(document.getElementById("input-word").value);
  });

  document.getElementById("btn-add-back").addEventListener("click", function () {
    if (editingId) {
      editingId = null;
      if (addReturnTo === "study") {
        resumeStudyAfterEdit();
      } else {
        renderManageList(document.getElementById("manage-search").value);
        showView("manage");
      }
    } else {
      // Add card is now only reachable from Manage cards' "+ Add card"
      // button (no longer a persistent tab), so leaving without saving
      // always lands back there.
      renderManageList(document.getElementById("manage-search").value);
      showView("manage");
    }
  });

  document.getElementById("form-add").addEventListener("submit", function (e) {
    e.preventDefault();
    var wordEl = document.getElementById("input-word");
    var transEl = document.getElementById("input-translation");
    var notesEl = document.getElementById("input-notes");

    var word = wordEl.value.trim();
    var translation = transEl.value.trim();
    var notes = notesEl.value.trim();

    if (!word || !translation) return;

    if (editingId) {
      var target = cards.find(function (c) { return c.id === editingId; });
      if (target) {
        target.word = word;
        target.translation = translation;
        target.notes = notes;
        target.sectionIds = editingSectionIds.slice();
        saveData();
      }
      editingId = null;
      if (addReturnTo === "study") {
        resumeStudyAfterEdit();
      } else {
        renderManageList(document.getElementById("manage-search").value);
        showView("manage");
      }
      return;
    }

    cards.push({
      id: uid(),
      word: word,
      translation: translation,
      notes: notes,
      sectionIds: editingSectionIds.slice(),
      box: 0,
      reviewed: false,
      dueAt: Date.now(),
      createdAt: Date.now()
    });
    saveData();

    wordEl.value = "";
    transEl.value = "";
    notesEl.value = "";
    updateSaveCardButtonState();
    wordEl.focus();

    var toast = document.getElementById("save-toast");
    toast.classList.remove("hidden");
    setTimeout(function () { toast.classList.add("hidden"); }, 1200);
  });

  // ---------- ask Gemini to create a deck ----------
  // Opens Gemini's web app with a prefilled prompt (same trusted-gesture <a>
  // click as openGoogleTranslate) asking it to generate an Anki-style
  // tab-separated word list this app's own importer already understands -
  // the user still has to paste Gemini's reply into a .txt file themselves
  // and run Import, hence the checkbox making sure that's understood upfront.
  function geminiFormFields() {
    return {
      theme: document.getElementById("gemini-theme"),
      count: document.getElementById("gemini-count"),
      language: document.getElementById("gemini-language"),
      deckName: document.getElementById("gemini-deck-name"),
      checkbox: document.getElementById("gemini-understand-checkbox"),
      send: document.getElementById("btn-gemini-send")
    };
  }

  function updateGeminiSendState() {
    var f = geminiFormFields();
    var count = parseInt(f.count.value, 10);
    var ready = !!f.theme.value.trim() &&
      !!f.language.value.trim() &&
      !!f.deckName.value.trim() &&
      !isNaN(count) && count > 0 &&
      f.checkbox.checked;
    f.send.disabled = !ready;
  }

  function openAskGeminiView() {
    var f = geminiFormFields();
    f.theme.value = "";
    f.count.value = "";
    f.language.value = "";
    f.deckName.value = "";
    f.checkbox.checked = false;
    updateGeminiSendState();
    showView("gemini");
    f.theme.focus();
  }

  document.getElementById("btn-ask-gemini").addEventListener("click", openAskGeminiView);

  document.getElementById("btn-gemini-back").addEventListener("click", function () {
    showView("add");
  });

  document.getElementById("gemini-count").addEventListener("input", function () {
    var digitsOnly = this.value.replace(/\D/g, "");
    if (digitsOnly !== this.value) this.value = digitsOnly;
    updateGeminiSendState();
  });

  ["gemini-theme", "gemini-language", "gemini-deck-name"].forEach(function (id) {
    document.getElementById(id).addEventListener("input", updateGeminiSendState);
  });

  document.getElementById("gemini-understand-checkbox").addEventListener("change", updateGeminiSendState);

  function buildGeminiPrompt(theme, count, language, deckName) {
    var deckTag = tagForSection(deckName.trim());
    return "Create a downloadable .txt file containing " + count + " Spanish vocabulary flashcards about the theme \"" + theme.trim() + "\". " +
      "For each one, include the Spanish word or phrase, its translation into " + language.trim() + ", " +
      "and a note containing both how the word is pronounced and one example sentence showing how it's used, in " + language.trim() + ". " +
      "Inside the file, put ONLY the raw data, one flashcard per line, as " + count + " lines total, with these fields " +
      "separated by a single TAB character (not spaces or commas): " +
      "Spanish word or phrase [TAB] translation in " + language.trim() + " [TAB] pronunciation and example sentence note [TAB] " + deckTag + ". " +
      "Do not include a header row, numbering, bullets, quotation marks, or markdown formatting in the file, and don't add any commentary before or after the list. " +
      "Please generate this as an actual downloadable .txt file I can save to my device, not just text in the chat reply.";
  }

  // Gemini's web app has no documented URL parameter for prefilling the
  // message box (unlike Google Translate's ?text=), so a link alone just
  // opens it empty - copying the prompt to the clipboard first is the only
  // reliable way to hand it over, with the user pasting it in themselves.
  function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () { fallbackCopyToClipboard(text); });
    } else {
      fallbackCopyToClipboard(text);
    }
  }

  function fallbackCopyToClipboard(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
  }

  document.getElementById("btn-gemini-send").addEventListener("click", function () {
    var f = geminiFormFields();
    if (f.send.disabled) return;
    var prompt = buildGeminiPrompt(f.theme.value, f.count.value, f.language.value, f.deckName.value);
    copyTextToClipboard(prompt);

    var toast = document.getElementById("gemini-copied-toast");
    toast.classList.remove("hidden");
    setTimeout(function () { toast.classList.add("hidden"); }, 2500);

    // iOS forces any external link tapped from a standalone home-screen web
    // app through its own in-app Safari View Controller sheet (Done button +
    // a Safari icon that fully opens the real browser) - that's true no
    // matter how the navigation is triggered here, and there's no JS-only
    // way around it short of Universal Links, which Gemini isn't registered
    // for. Given the sheet is unavoidable either way, target="_blank" at
    // least keeps this app's own window untouched underneath it, so tapping
    // Done returns to the form exactly as it was instead of a blank page.
    var a = document.createElement("a");
    a.href = "https://gemini.google.com/app";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });

  // ---------- manage ----------
  function populateManageSectionFilter() {
    var sel = document.getElementById("manage-section-filter");
    var current = sel.value;
    sel.innerHTML = "";

    var allOpt = document.createElement("option");
    allOpt.value = "";
    allOpt.textContent = "All decks";
    sel.appendChild(allOpt);

    sections.forEach(function (s) {
      var opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name;
      sel.appendChild(opt);
    });

    var unsectionedOpt = document.createElement("option");
    unsectionedOpt.value = "unsectioned";
    unsectionedOpt.textContent = "No card deck";
    sel.appendChild(unsectionedOpt);

    if (Array.prototype.some.call(sel.options, function (o) { return o.value === current; })) {
      sel.value = current;
    }
  }

  // ---------- bulk select/delete ----------
  var manageSelectMode = false;
  var manageSelectedIds = new Set();
  var lastManageListIds = [];

  function updateManageSelectUI() {
    document.getElementById("btn-manage-select-toggle").textContent = manageSelectMode ? "Cancel" : "Select";
    document.getElementById("bulk-actions-bar").classList.toggle("hidden", !manageSelectMode);
    document.getElementById("bulk-actions-count").textContent = manageSelectedIds.size + " selected";
    document.getElementById("btn-bulk-delete").disabled = manageSelectedIds.size === 0;
    var allSelected = lastManageListIds.length > 0 && lastManageListIds.every(function (id) { return manageSelectedIds.has(id); });
    document.getElementById("btn-bulk-select-all").textContent = allSelected ? "Unselect all" : "Select all";
  }

  document.getElementById("btn-manage-select-toggle").addEventListener("click", function () {
    manageSelectMode = !manageSelectMode;
    manageSelectedIds.clear();
    updateManageSelectUI();
    renderManageList(document.getElementById("manage-search").value);
  });

  document.getElementById("btn-manage-add-card").addEventListener("click", function () {
    openAddView(null);
  });

  document.getElementById("btn-bulk-select-all").addEventListener("click", function () {
    var allSelected = lastManageListIds.length > 0 && lastManageListIds.every(function (id) { return manageSelectedIds.has(id); });
    lastManageListIds.forEach(function (id) {
      if (allSelected) manageSelectedIds.delete(id);
      else manageSelectedIds.add(id);
    });
    updateManageSelectUI();
    renderManageList(document.getElementById("manage-search").value);
  });

  document.getElementById("btn-bulk-delete").addEventListener("click", function () {
    var count = manageSelectedIds.size;
    if (count === 0) return;
    if (!confirm("Delete " + count + " card" + (count === 1 ? "" : "s") + "?")) return;
    cards = cards.filter(function (c) { return !manageSelectedIds.has(c.id); });
    saveData();
    manageSelectMode = false;
    manageSelectedIds.clear();
    updateManageSelectUI();
    updateGlobalStats();
    renderManageList(document.getElementById("manage-search").value);
  });

  function renderManageList(filter) {
    var list = document.getElementById("manage-list");
    list.innerHTML = "";
    openManageSwipeRow = null;

    var sectionFilterVal = document.getElementById("manage-section-filter").value;
    var masteryFilterVal = document.getElementById("manage-mastery-filter").value;

    var items = cards.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    if (filter) {
      var f = filter.toLowerCase();
      items = items.filter(function (c) {
        return c.word.toLowerCase().indexOf(f) !== -1 ||
               c.translation.toLowerCase().indexOf(f) !== -1;
      });
    }
    if (sectionFilterVal === "unsectioned") {
      items = items.filter(function (c) { return c.sectionIds.length === 0; });
    } else if (sectionFilterVal) {
      items = items.filter(function (c) { return c.sectionIds.indexOf(sectionFilterVal) !== -1; });
    }
    if (masteryFilterVal) {
      items = items.filter(function (c) { return masteryTier(c) === masteryFilterVal; });
    }

    lastManageListIds = items.map(function (c) { return c.id; });

    if (items.length === 0) {
      var empty = document.createElement("div");
      empty.className = "manage-empty";
      empty.textContent = cards.length === 0 ? "No cards yet. Add your first one!" : "No matches.";
      list.appendChild(empty);
      return;
    }

    items.forEach(function (c) {
      var row = document.createElement("div");
      row.className = "manage-item" + (manageSelectMode && manageSelectedIds.has(c.id) ? " selected" : "");

      var text = document.createElement("div");
      text.className = "manage-item-text";

      var word = document.createElement("div");
      word.className = "manage-item-word";
      word.textContent = c.word;

      var translation = document.createElement("div");
      translation.className = "manage-item-translation";
      translation.textContent = c.translation;

      text.appendChild(word);
      text.appendChild(translation);

      if (c.notes) {
        var notes = document.createElement("div");
        notes.className = "manage-item-meta";
        notes.textContent = c.notes;
        text.appendChild(notes);
      }

      var deckRefs = sectionRefs(c);
      if (deckRefs.length > 0) {
        var sectionsRow = document.createElement("div");
        sectionsRow.className = "chip-list chip-list-inline";
        deckRefs.forEach(function (s) {
          var chip = document.createElement("span");
          chip.className = "chip chip-tag";
          chip.textContent = s.name;
          applyDeckTint(chip, s.color);
          sectionsRow.appendChild(chip);
        });
        text.appendChild(sectionsRow);
      }

      var meta = document.createElement("div");
      meta.className = "manage-item-meta";
      var now = Date.now();
      meta.textContent = isDue(c, now) ? "To learn" : "Due " + formatRelative(c.dueAt - now);
      text.appendChild(meta);

      var elementToAppend = row;

      if (manageSelectMode) {
        var selectBox = document.createElement("input");
        selectBox.type = "checkbox";
        selectBox.className = "manage-item-select";
        selectBox.checked = manageSelectedIds.has(c.id);
        selectBox.addEventListener("change", function () {
          if (selectBox.checked) manageSelectedIds.add(c.id);
          else manageSelectedIds.delete(c.id);
          row.classList.toggle("selected", selectBox.checked);
          updateManageSelectUI();
        });
        row.appendChild(text);
        row.appendChild(selectBox);
      } else {
        var swipeWrap = document.createElement("div");
        swipeWrap.className = "manage-item-swipe";

        var swipeInner = document.createElement("div");
        swipeInner.className = "manage-item-swipe-inner";

        var actionsPanel = document.createElement("div");
        actionsPanel.className = "manage-item-swipe-actions";

        var edit = document.createElement("button");
        edit.className = "manage-item-edit";
        edit.textContent = "Edit";
        edit.addEventListener("click", function () {
          openAddView(c);
        });

        var del = document.createElement("button");
        del.className = "manage-item-delete";
        del.textContent = "Delete";
        del.addEventListener("click", function () {
          if (!confirm('Delete "' + c.word + '"?')) return;
          cards = cards.filter(function (x) { return x.id !== c.id; });
          saveData();
          updateGlobalStats();
          renderManageList(document.getElementById("manage-search").value);
        });

        actionsPanel.appendChild(edit);
        actionsPanel.appendChild(del);

        row.appendChild(text);
        row.classList.add("manage-item-linkable");
        row.addEventListener("click", function () {
          if (swipeInner._suppressClick) { swipeInner._suppressClick = false; return; }
          if (openManageSwipeRow === swipeInner) { closeManageSwipeRow(); return; }
          openCardPreview(c);
        });

        swipeInner.appendChild(row);
        swipeInner.appendChild(actionsPanel);
        attachManageSwipe(swipeInner);
        swipeWrap.appendChild(swipeInner);
        elementToAppend = swipeWrap;
      }
      list.appendChild(elementToAppend);
    });
  }

  // ---------- swipe-to-reveal (Manage cards rows) ----------
  // Same "let a real drag pass a threshold before treating it as a swipe"
  // approach as the practice card's swipe-to-answer, so a normal vertical
  // scroll of the list is never hijacked into an accidental reveal.
  var MANAGE_SWIPE_WIDTH = 152;
  var openManageSwipeRow = null;

  function closeManageSwipeRow() {
    if (openManageSwipeRow) {
      openManageSwipeRow.style.transition = "transform 0.25s ease";
      openManageSwipeRow.style.transform = "";
      openManageSwipeRow = null;
    }
  }

  function attachManageSwipe(rowEl) {
    var startX = 0, startY = 0, dx = 0, dragging = false, isSwipe = false, baseOffset = 0;

    rowEl.addEventListener("touchstart", function (e) {
      if (openManageSwipeRow && openManageSwipeRow !== rowEl) closeManageSwipeRow();
      var t = e.touches[0];
      startX = t.clientX; startY = t.clientY; dx = 0; dragging = true; isSwipe = false;
      baseOffset = openManageSwipeRow === rowEl ? -MANAGE_SWIPE_WIDTH : 0;
      rowEl.style.transition = "none";
    }, { passive: true });

    rowEl.addEventListener("touchmove", function (e) {
      if (!dragging) return;
      var t = e.touches[0];
      dx = t.clientX - startX;
      var dy = t.clientY - startY;
      if (!isSwipe && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) isSwipe = true;
      if (isSwipe) {
        e.preventDefault();
        var next = Math.min(0, Math.max(-MANAGE_SWIPE_WIDTH, baseOffset + dx));
        rowEl.style.transform = "translateX(" + next + "px)";
      }
    }, { passive: false });

    rowEl.addEventListener("touchend", function () {
      dragging = false;
      rowEl.style.transition = "transform 0.25s ease";
      if (!isSwipe) return;
      rowEl._suppressClick = true;
      var finalOffset = Math.min(0, Math.max(-MANAGE_SWIPE_WIDTH, baseOffset + dx));
      if (finalOffset < -MANAGE_SWIPE_WIDTH / 2) {
        rowEl.style.transform = "translateX(-" + MANAGE_SWIPE_WIDTH + "px)";
        openManageSwipeRow = rowEl;
      } else {
        rowEl.style.transform = "";
        if (openManageSwipeRow === rowEl) openManageSwipeRow = null;
      }
    }, { passive: true });
  }

  function formatRelative(ms) {
    var days = Math.round(ms / 86400000);
    if (days <= 0) return "today";
    if (days === 1) return "in 1 day";
    return "in " + days + " days";
  }

  document.getElementById("manage-search").addEventListener("input", function (e) {
    renderManageList(e.target.value);
  });

  document.getElementById("manage-section-filter").addEventListener("change", function () {
    renderManageList(document.getElementById("manage-search").value);
  });

  document.getElementById("manage-mastery-filter").addEventListener("change", function () {
    renderManageList(document.getElementById("manage-search").value);
  });

  function openManageFilteredByMastery(tier) {
    manageReturnTo = "home";
    updateGlobalStats();
    populateManageSectionFilter();
    document.getElementById("manage-section-filter").value = "";
    document.getElementById("manage-mastery-filter").value = tier;
    document.getElementById("manage-search").value = "";
    manageSelectMode = false;
    manageSelectedIds.clear();
    updateManageSelectUI();
    renderManageList();
    showView("manage");
  }

  document.querySelectorAll(".mastery-seg, .mastery-legend-item").forEach(function (el) {
    el.addEventListener("click", function () {
      openManageFilteredByMastery(el.dataset.tier);
    });
  });

  document.getElementById("btn-manage-back").addEventListener("click", function () {
    if (manageReturnTo === "sections") {
      renderSectionsList();
      showView("sections");
    } else {
      refreshHome();
      showView("home");
    }
    manageReturnTo = "home";
  });

  // ---------- sections management ----------
  function renderSectionsList() {
    var list = document.getElementById("sections-list");
    list.innerHTML = "";

    if (sections.length === 0) {
      var empty = document.createElement("div");
      empty.className = "manage-empty";
      empty.textContent = "No card decks yet. Create one above to start grouping cards by topic.";
      list.appendChild(empty);
      return;
    }

    sections.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (s) {
      var count = cards.filter(function (c) { return c.sectionIds.indexOf(s.id) !== -1; }).length;

      var row = document.createElement("div");
      row.className = "manage-item manage-item-linkable";
      applyDeckTint(row, s.color);
      row.addEventListener("click", function (e) {
        if (e.target.closest(".manage-item-actions")) return;
        openManageForSection(s.id);
      });

      var text = document.createElement("div");
      text.className = "manage-item-text";

      var name = document.createElement("div");
      name.className = "manage-item-word";
      name.textContent = s.name;

      var meta = document.createElement("div");
      meta.className = "manage-item-meta";
      meta.textContent = count + " card" + (count === 1 ? "" : "s");

      text.appendChild(name);
      text.appendChild(meta);

      var actions = document.createElement("div");
      actions.className = "manage-item-actions";

      var rename = document.createElement("button");
      rename.className = "manage-item-edit";
      rename.textContent = "Rename";
      rename.addEventListener("click", function () {
        var newName = prompt("Rename card deck", s.name);
        if (newName === null) return;
        newName = newName.trim();
        if (!newName) return;
        renameSection(s.id, newName);
        renderSectionsList();
      });

      var del = document.createElement("button");
      del.className = "manage-item-delete";
      del.textContent = "Delete";
      del.addEventListener("click", function () {
        if (!confirm('Delete card deck "' + s.name + '"? Cards keep their other card decks.')) return;
        deleteSection(s.id);
        renderSectionsList();
      });

      actions.appendChild(rename);
      actions.appendChild(del);

      row.appendChild(text);
      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  document.getElementById("btn-open-new-deck").addEventListener("click", function () {
    openNewDeckModal("sections");
  });

  document.getElementById("btn-sections-back").addEventListener("click", function () {
    refreshHome();
    showView("home");
  });

  // ---------- study setup (choose mode + sections) ----------
  var currentSectionFilter = null;
  var currentStudyMode = (lastStudyPrefs && lastStudyPrefs.mode) || "normal";

  function renderModePicker() {
    var buttons = document.querySelectorAll("#mode-picker .chip");
    Array.prototype.forEach.call(buttons, function (btn) {
      btn.classList.toggle("active", btn.dataset.mode === currentStudyMode);
    });
  }

  document.querySelectorAll("#mode-picker .chip").forEach(function (btn) {
    btn.addEventListener("click", function () {
      currentStudyMode = btn.dataset.mode;
      renderModePicker();
    });
  });

  function renderStudySetup() {
    renderModePicker();

    var prefSectionIds = lastStudyPrefs ? lastStudyPrefs.sectionIds : null;
    var prefIncludeUnsectioned = lastStudyPrefs ? lastStudyPrefs.includeUnsectioned : true;

    var list = document.getElementById("section-picker-list");
    list.innerHTML = "";

    sections.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (s) {
      var count = cards.filter(function (c) { return c.sectionIds.indexOf(s.id) !== -1; }).length;
      var checked = prefSectionIds ? prefSectionIds.indexOf(s.id) !== -1 : true;
      list.appendChild(buildSectionPickerRow(s.id, s.name, count, checked));
    });

    var unsectionedCount = cards.filter(function (c) { return c.sectionIds.length === 0; }).length;
    list.appendChild(buildSectionPickerRow("unsectioned", "No card deck", unsectionedCount, prefIncludeUnsectioned));

    updateStudyStartState();
  }

  function buildSectionPickerRow(value, label, count, checked) {
    var row = document.createElement("label");
    row.className = "section-picker-row";

    var checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = value;
    checkbox.checked = checked;

    var text = document.createElement("span");
    text.textContent = label + " (" + count + ")";

    row.appendChild(checkbox);
    row.appendChild(text);
    return row;
  }

  function studySetupCheckboxes() {
    return Array.prototype.slice.call(
      document.querySelectorAll("#section-picker-list input[type=checkbox]")
    );
  }

  function updateStudyStartState() {
    var checked = studySetupCheckboxes().filter(function (cb) { return cb.checked; }).map(function (cb) { return cb.value; });
    var includeUnsectioned = checked.indexOf("unsectioned") !== -1;
    var sectionIds = checked.filter(function (v) { return v !== "unsectioned"; });
    var filter = { ids: new Set(sectionIds), includeUnsectioned: includeUnsectioned };
    var matchCount = cards.filter(function (c) { return matchesFilter(c, filter); }).length;
    document.getElementById("btn-study-start").disabled = matchCount === 0;
  }

  document.getElementById("section-picker-list").addEventListener("change", updateStudyStartState);

  document.getElementById("btn-section-picker-all").addEventListener("click", function () {
    studySetupCheckboxes().forEach(function (cb) { cb.checked = true; });
    updateStudyStartState();
  });

  document.getElementById("btn-section-picker-none").addEventListener("click", function () {
    studySetupCheckboxes().forEach(function (cb) { cb.checked = false; });
    updateStudyStartState();
  });

  document.getElementById("btn-study-setup-back").addEventListener("click", function () {
    refreshHome();
    showView("home");
  });

  document.getElementById("btn-study-start").addEventListener("click", function () {
    var checked = studySetupCheckboxes().filter(function (cb) { return cb.checked; }).map(function (cb) { return cb.value; });
    var includeUnsectioned = checked.indexOf("unsectioned") !== -1;
    var sectionIds = checked.filter(function (v) { return v !== "unsectioned"; });
    currentSectionFilter = { ids: new Set(sectionIds), includeUnsectioned: includeUnsectioned };

    lastStudyPrefs = { sectionIds: sectionIds, includeUnsectioned: includeUnsectioned, mode: currentStudyMode };
    saveData();

    startStudy(false, currentSectionFilter, currentStudyMode);
  });

  // ---------- study session ----------
  // Cards that fail once come back after at least 10 other cards (or at the
  // very end if fewer than 10 remain); a second miss moves them into
  // reviewQueue instead, a separate bucket only drained once the main queue
  // is empty, shown under the "Let's review..." label so they're clearly
  // set apart as repeat misses rather than mixed back into the regular flow.
  var STUDY_REQUEUE_GAP = 10;
  var session = { queue: [], reviewQueue: [], failCounts: {}, inReview: false, current: null, revealed: false, studied: 0, passed: 0, failed: 0, allMode: false, mode: "normal" };

  function startStudy(allMode, sectionFilter, mode) {
    if (sectionFilter !== undefined) currentSectionFilter = sectionFilter;
    if (mode !== undefined) currentStudyMode = mode;
    var matches = cards.filter(function (c) { return matchesFilter(c, currentSectionFilter); });
    var source = allMode ? matches : matches.filter(function (c) { return isDue(c, Date.now()); });
    if (source.length === 0) {
      if (cards.length === 0) showEmpty("no-cards");
      else if (matches.length === 0) showEmpty("no-match");
      else showEmpty("no-due");
      return;
    }
    session.queue = shuffle(source.slice());
    session.reviewQueue = [];
    session.failCounts = {};
    session.inReview = false;
    session.studied = 0;
    session.passed = 0;
    session.failed = 0;
    session.allMode = !!allMode;
    session.mode = currentStudyMode;
    showView("study");
    nextCard();
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  // Pulled out of nextCard() so resumeStudyAfterEdit() can refresh the face
  // text (word/translation/note may have just changed) without resetting
  // the flip/reveal state the way loading a new card would.
  function updateStudyCardContent() {
    var reversed = session.mode === "reversed" || session.mode === "type";
    document.getElementById("card-word").textContent = reversed ? session.current.translation : session.current.word;
    document.getElementById("card-translation").textContent = reversed ? session.current.word : session.current.translation;

    var hasNote = !!session.current.notes;
    document.getElementById("card-note").classList.toggle("hidden", !hasNote);
    document.getElementById("card-note-text").textContent = hasNote ? session.current.notes : "";
  }

  function nextCard() {
    if (session.queue.length === 0) {
      if (session.reviewQueue.length === 0) {
        finishStudy();
        return;
      }
      session.queue = session.reviewQueue;
      session.reviewQueue = [];
      session.inReview = true;
    }
    document.getElementById("study-review-label").classList.toggle("hidden", !session.inReview);

    session.current = session.queue.shift();
    session.revealed = false;

    var cardEl = document.getElementById("card");
    cardEl.classList.remove("flipped", "swipe-pass", "swipe-fail", "answer-correct", "answer-incorrect");
    cardEl.style.transition = "";
    cardEl.style.transform = "";
    cardEl.style.opacity = "";
    var cardWordEl = document.getElementById("card-word");
    cardWordEl.style.transform = "";
    updateStudyCardContent();
    document.getElementById("card-your-answer").classList.add("hidden");

    var isTypeMode = session.mode === "type";
    var typeBar = document.getElementById("type-answer-bar");
    typeBar.classList.toggle("hidden", !isTypeMode);
    typeBar.style.bottom = "";
    var typeInput = document.getElementById("type-answer-input");
    typeInput.value = "";
    typeInput.readOnly = false;
    typeInput.classList.remove("hidden");
    document.getElementById("btn-type-check").disabled = true;
    document.getElementById("type-answer-buttons").classList.remove("hidden");
    document.getElementById("btn-study-next").classList.add("hidden");

    // Reserve space below the card equal to the bar's resting height (input +
    // buttons visible, not yet floated above a keyboard), so the card centers
    // between the header and where the bar sits rather than behind it.
    document.documentElement.style.setProperty(
      "--type-bar-height", isTypeMode ? typeBar.offsetHeight + "px" : "0px"
    );

    var tapHintEl = document.getElementById("tap-hint");
    tapHintEl.classList.toggle("hidden", isTypeMode);
    tapHintEl.textContent = isTypeMode ? "" : "Tap card to reveal";
    document.getElementById("study-answer-controls").classList.add("hidden");
    updateProgress();
  }

  function updateProgress() {
    // "Done" only counts correct answers - a wrong answer keeps its card
    // circulating (requeued or moved to the review bucket) rather than
    // leaving the pool, so remaining (still-circulating cards, including
    // the one on screen) and passed always add back up to the session
    // total on their own, with no separate counter needed.
    var remaining = session.queue.length + session.reviewQueue.length + 1;
    document.getElementById("study-progress").textContent =
      session.passed + " done · " + remaining + " left";
    var total = session.passed + remaining;
    var pct = total > 0 ? (session.passed / total * 100) : 0;
    document.getElementById("study-progress-fill").style.width = pct + "%";
  }

  // Case-insensitive and forgiving of accent marks/ñ (NFD-decomposing a
  // letter like "ñ" or "á" splits it into a base letter plus a separate
  // combining mark, so stripping those marks handles every accented
  // Spanish letter generically) and of exclamation/question marks, so
  // typing without a Spanish keyboard still counts as correct.
  function normalizeTypedAnswer(s) {
    return s
      .normalize("NFD")
      .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
      .replace(/[¡¿!?]/g, "")
      .trim()
      .toLowerCase();
  }

  // Same accent/case leniency as normalizeTypedAnswer, but per character,
  // so a single mismatched letter can be spotted without the accent-mark
  // stripping shifting one string's length relative to the other.
  function normalizeChar(ch) {
    return ch.normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "").toLowerCase();
  }

  // Renders what was typed with each character colored to match or
  // mismatch the correct word at that position - built with textContent
  // per character (not innerHTML) since the typed value is user input.
  // Stripping ¡¿!? from the correct word first (the same leniency
  // normalizeTypedAnswer applies for the pass/fail check) keeps the two
  // strings aligned by position - a phrase like "¿Podemos turnar?" would
  // otherwise shift every later character by one and mismatch the whole
  // thing just because of the leading ¿.
  function renderTypedAnswerDiff(container, typed, correct) {
    correct = correct.replace(/[¡¿!?]/g, "");
    container.innerHTML = "";
    for (var i = 0; i < typed.length; i++) {
      var span = document.createElement("span");
      var isMatch = i < correct.length && normalizeChar(typed[i]) === normalizeChar(correct[i]);
      span.className = isMatch ? "char-match" : "char-mismatch";
      span.textContent = typed[i];
      container.appendChild(span);
    }
  }

  function revealCard(forceIncorrect) {
    if (session.revealed || !session.current) return;
    session.revealed = true;
    document.getElementById("card").classList.add("flipped");
    document.getElementById("tap-hint").textContent = "";

    if (session.mode === "type") {
      var typeInput = document.getElementById("type-answer-input");
      var typedValue = typeInput.value.trim();
      var correct;
      if (forceIncorrect) {
        correct = false;
      } else {
        correct = normalizeTypedAnswer(typedValue) === normalizeTypedAnswer(session.current.word);
      }
      session.typeCorrect = correct;
      document.getElementById("card").classList.toggle("answer-correct", correct);
      document.getElementById("card").classList.toggle("answer-incorrect", !correct);

      var yourAnswerEl = document.getElementById("card-your-answer");
      if (!correct && typedValue) {
        renderTypedAnswerDiff(document.getElementById("card-your-answer-text"), typedValue, session.current.word);
        yourAnswerEl.classList.remove("hidden");
      } else {
        yourAnswerEl.classList.add("hidden");
      }

      typeInput.readOnly = true;
      typeInput.blur();
      typeInput.classList.add("hidden");
      document.getElementById("type-answer-buttons").classList.add("hidden");
      document.getElementById("btn-study-next").classList.remove("hidden");
    } else {
      document.getElementById("study-answer-controls").classList.remove("hidden");
    }
  }

  document.getElementById("card").addEventListener("click", function () {
    if (session.mode === "type") return;
    revealCard();
  });

  document.getElementById("btn-pass").addEventListener("click", function () {
    answerCard(true);
  });
  document.getElementById("btn-fail").addEventListener("click", function () {
    answerCard(false);
  });
  // Tapping either button while the type-answer input is still focused
  // would otherwise blur it first, which snaps the floating input/Check
  // bar back to its resting position (see the blur handler below) before
  // the resulting click has a chance to land - moving the button out from
  // under the tap so the first press only closes the keyboard, requiring
  // a second tap to actually register. Blocking mousedown's default
  // focus-shift keeps the input (and the bar) exactly where they were
  // until revealCard() itself deliberately blurs the input.
  document.getElementById("btn-type-check").addEventListener("mousedown", function (e) {
    e.preventDefault();
  });
  document.getElementById("btn-type-idk").addEventListener("mousedown", function (e) {
    e.preventDefault();
  });

  document.getElementById("btn-type-check").addEventListener("click", function () {
    revealCard(false);
  });
  document.getElementById("btn-type-idk").addEventListener("click", function () {
    revealCard(true);
  });
  document.getElementById("btn-study-next").addEventListener("click", function () {
    answerCard(!!session.typeCorrect);
  });

  document.getElementById("type-answer-input").addEventListener("input", function () {
    document.getElementById("btn-type-check").disabled = !this.value.trim();
  });

  document.getElementById("btn-study-translate").addEventListener("click", function () {
    if (session.current) openGoogleTranslate(session.current.word);
  });

  // Editing mutates the same card object the session queue already holds,
  // so resuming just needs to redraw the (possibly changed) text - the
  // flip/reveal state and the rest of the session were never touched since
  // #view-study was only hidden, not torn down, while the add view was up.
  document.getElementById("btn-study-edit-card").addEventListener("click", function (e) {
    e.stopPropagation();
    if (!session.current) return;
    addReturnTo = "study";
    openAddView(session.current);
  });
  document.getElementById("btn-study-edit-card").addEventListener("touchstart", function (e) {
    e.stopPropagation();
  }, { passive: true });

  function resumeStudyAfterEdit() {
    addReturnTo = "manage";
    if (session.current) updateStudyCardContent();
    showView("study");
  }

  // ---------- swipe to answer ----------
  var SWIPE_THRESHOLD = 90;
  var swipe = null;
  var swipeCardEl = document.getElementById("card");

  swipeCardEl.addEventListener("touchstart", function (e) {
    if (!session.revealed || session.mode === "type") return;
    var t = e.touches[0];
    swipe = { startX: t.clientX, startY: t.clientY, dx: 0, dy: 0 };
    swipeCardEl.style.transition = "none";
  }, { passive: true });

  swipeCardEl.addEventListener("touchmove", function (e) {
    if (!swipe) return;
    var t = e.touches[0];
    swipe.dx = t.clientX - swipe.startX;
    swipe.dy = t.clientY - swipe.startY;
    if (Math.abs(swipe.dx) > Math.abs(swipe.dy)) {
      e.preventDefault();
      swipeCardEl.style.transform = "translateX(" + swipe.dx + "px) rotate(" + (swipe.dx / 20) + "deg)";
      swipeCardEl.classList.toggle("swipe-pass", swipe.dx > 30);
      swipeCardEl.classList.toggle("swipe-fail", swipe.dx < -30);
    }
  }, { passive: false });

  swipeCardEl.addEventListener("touchend", function () {
    if (!swipe) return;
    var dx = swipe.dx, dy = swipe.dy;
    swipe = null;
    swipeCardEl.classList.remove("swipe-pass", "swipe-fail");

    if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      var passed = dx > 0;
      swipeCardEl.style.transition = "transform 0.22s ease-out, opacity 0.22s ease-out";
      swipeCardEl.style.transform = "translateX(" + (passed ? 700 : -700) + "px) rotate(" + (passed ? 20 : -20) + "deg)";
      swipeCardEl.style.opacity = "0";
      setTimeout(function () { answerCard(passed); }, 200);
    } else {
      swipeCardEl.style.transition = "transform 0.25s ease-out";
      swipeCardEl.style.transform = "";
    }
  }, { passive: true });

  function answerCard(passed) {
    var c = session.current;
    if (!c) return;
    session.studied++;
    recordStudyActivity();
    c.reviewed = true;

    if (passed) {
      session.passed++;
      c.box = Math.min(c.box + 1, MAX_BOX);
      c.dueAt = Date.now() + BOX_INTERVALS_DAYS[c.box] * 86400000;
    } else {
      session.failed++;
      c.box = 0;
      c.dueAt = Date.now();
      var fails = (session.failCounts[c.id] || 0) + 1;
      session.failCounts[c.id] = fails;
      if (fails === 1) {
        // First miss: come back after at least 10 other cards (or at the
        // end of the queue if fewer than 10 remain).
        var insertAt = Math.min(session.queue.length, STUDY_REQUEUE_GAP);
        session.queue.splice(insertAt, 0, c);
      } else {
        // A repeat miss - set it aside for the review pass at the end
        // instead of mixing it back into the regular queue.
        session.reviewQueue.push(c);
      }
    }
    saveData();
    nextCard();
  }

  function finishStudy() {
    var text = "Practiced " + session.studied + " card" + (session.studied === 1 ? "" : "s") +
      " · " + session.passed + " knew it · " + session.failed + " didn't know";
    showEmpty("finished", text);
  }

  function showEmpty(kind, text) {
    var icon = document.getElementById("empty-icon");
    var msg = document.getElementById("empty-text");
    var studyAllBtn = document.getElementById("btn-study-all-anyway");
    studyAllBtn.classList.add("hidden");

    icon.classList.remove("celebrate");

    if (kind === "no-cards") {
      icon.textContent = "📝";
      msg.textContent = "No cards yet. Add some to start practicing!";
    } else if (kind === "no-match") {
      icon.textContent = "🗂️";
      msg.textContent = "No cards in the selected card decks.";
    } else if (kind === "no-due") {
      icon.textContent = "✅";
      msg.textContent = "Nothing due right now. Nice work!";
      studyAllBtn.classList.remove("hidden");
    } else {
      icon.textContent = "🎉";
      msg.textContent = text || "All done for now!";
      void icon.offsetWidth; // force reflow so the animation restarts every time
      icon.classList.add("celebrate");
    }
    showView("empty");
  }

  document.getElementById("btn-study-back").addEventListener("click", function () {
    refreshHome();
    showView("home");
  });

  document.getElementById("btn-empty-home").addEventListener("click", function () {
    refreshHome();
    showView("home");
  });

  document.getElementById("btn-study-all-anyway").addEventListener("click", function () {
    startStudy(true);
  });

  // ---------- import / export (Anki-style tab-separated text) ----------
  // Same format Anki itself reads/writes via File > Export > "Notes in Plain Text (.txt)"
  // and File > Import: "#"-prefixed header lines, then one note per line as
  // tab-separated fields. Card decks round-trip as hierarchical "deck::Name" tags,
  // Anki's own mechanism for grouping notes by more than one category at once.
  var SECTION_TAG_PREFIX = "deck::";
  // "section::" is recognized on import too - it was this app's tag prefix
  // before card decks were renamed from "sections", and files exported
  // under that name would otherwise have their deck tags silently dropped.
  var SECTION_TAG_PREFIXES_READ = ["deck::", "section::"];

  function tagForSection(name) {
    return SECTION_TAG_PREFIX + name.replace(/\s+/g, "_");
  }

  function sectionNameFromTag(tag) {
    var lower = tag.toLowerCase();
    var prefix = SECTION_TAG_PREFIXES_READ.filter(function (p) { return lower.indexOf(p) === 0; })[0];
    if (!prefix) return null;
    return tag.slice(prefix.length).replace(/_/g, " ");
  }

  function tsvEscape(field) {
    return String(field).replace(/[\t\r\n]/g, " ").trim();
  }

  function performExport() {
    var lines = [
      "#separator:tab",
      "#html:false",
      "#notetype:Basic",
      "#tags column:4",
      "#streak-current:" + streak.current,
      "#streak-last-date:" + (streak.lastDate || ""),
      "#notepad:" + encodeURIComponent(notepadText || "")
    ];

    cards.forEach(function (c) {
      var tags = sectionNames(c).map(tagForSection).join(" ");
      lines.push([
        tsvEscape(c.word),
        tsvEscape(c.translation),
        tsvEscape(c.notes || ""),
        tags,
        c.box,
        c.dueAt,
        c.reviewed ? 1 : 0
      ].join("\t"));
    });

    var data = lines.join("\n") + "\n";
    var blob = new Blob([data], { type: "text/plain" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    var date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = "spanish-cards-" + date + ".txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);

    lastExportAt = Date.now();
    saveData();
  }

  document.getElementById("btn-export").addEventListener("click", performExport);

  document.getElementById("btn-import").addEventListener("click", function () {
    document.getElementById("file-import").click();
  });

  function parseAnkiTsv(text) {
    var items = [];
    var importedStreak = null;
    var importedNotepad = null;

    text.split(/\r?\n/).forEach(function (line) {
      if (!line) return;
      if (line.charAt(0) === "#") {
        if (line.indexOf("#streak-current:") === 0) {
          importedStreak = importedStreak || {};
          importedStreak.current = parseInt(line.slice("#streak-current:".length), 10) || 0;
        } else if (line.indexOf("#streak-last-date:") === 0) {
          importedStreak = importedStreak || {};
          importedStreak.lastDate = line.slice("#streak-last-date:".length).trim() || null;
        } else if (line.indexOf("#notepad:") === 0) {
          try { importedNotepad = decodeURIComponent(line.slice("#notepad:".length)); } catch (e) {}
        }
        return;
      }

      var cols = line.split("\t");
      if (cols.length < 2) return;

      var word = cols[0], translation = cols[1], notes = "", tagsStr = "";
      if (cols.length >= 4) {
        notes = cols[2];
        tagsStr = cols[3];
      } else if (cols.length === 3) {
        tagsStr = cols[2];
      }

      var sectionNamesList = tagsStr.trim()
        ? tagsStr.trim().split(/\s+/).map(sectionNameFromTag).filter(Boolean)
        : [];

      if (!word.trim() || !translation.trim()) return;
      var item = { word: word, translation: translation, notes: notes, sectionNamesList: sectionNamesList };

      if (cols.length >= 6) {
        var box = parseInt(cols[4], 10);
        var dueAt = parseInt(cols[5], 10);
        if (!isNaN(box)) item.box = box;
        if (!isNaN(dueAt)) item.dueAt = dueAt;
      }
      if (cols.length >= 7) {
        item.reviewed = cols[6] === "1";
      }

      items.push(item);
    });

    return { items: items, streak: importedStreak, notepad: importedNotepad };
  }

  // still accepted for backwards compatibility with files exported before this format changed
  function parseLegacyJson(text) {
    var data = JSON.parse(text);
    var incoming = Array.isArray(data) ? data : data.cards;
    if (!Array.isArray(incoming)) throw new Error("Invalid file format");
    var items = incoming
      .filter(function (item) { return item && item.word && item.translation; })
      .map(function (item) {
        return {
          word: String(item.word),
          translation: String(item.translation),
          notes: item.notes ? String(item.notes) : "",
          sectionNamesList: [],
          box: typeof item.box === "number" ? Math.min(Math.max(item.box, 0), MAX_BOX) : 0,
          dueAt: typeof item.dueAt === "number" ? item.dueAt : Date.now(),
          createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now()
        };
      });
    return { items: items, streak: null };
  }

  document.getElementById("file-import").addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var text = reader.result;
        var trimmed = text.trim();
        var parsed = (trimmed.charAt(0) === "{" || trimmed.charAt(0) === "[")
          ? parseLegacyJson(text)
          : parseAnkiTsv(text);
        var incoming = parsed.items;

        // Only adopt an imported streak on a fresh start - otherwise importing
        // someone else's export (or a re-import) would clobber a streak
        // that's already actively being built up on this device.
        if (parsed.streak && streak.current === 0) {
          streak = { current: parsed.streak.current || 0, lastDate: parsed.streak.lastDate || null };
        }

        // Same caution as the streak above - only adopt an imported notepad
        // when there's nothing written locally yet, so it can't clobber
        // notes already in progress on this device.
        if (parsed.notepad && !notepadText) {
          notepadText = parsed.notepad;
        }

        var existingByKey = {};
        cards.forEach(function (c) {
          existingByKey[c.word.toLowerCase() + "|" + c.translation.toLowerCase()] = c;
        });
        var added = 0;
        incoming.forEach(function (item) {
          var key = item.word.toLowerCase() + "|" + item.translation.toLowerCase();

          var sectionIds = item.sectionNamesList.map(function (name) {
            return getOrCreateSectionByName(name).id;
          });

          var existing = existingByKey[key];
          if (existing) {
            // A duplicate word shouldn't mean its deck tags in the imported
            // file get silently ignored - merge in any new memberships.
            sectionIds.forEach(function (id) {
              if (existing.sectionIds.indexOf(id) === -1) existing.sectionIds.push(id);
            });
            return;
          }

          var importedBox = typeof item.box === "number" ? item.box : 0;

          var newCard = {
            id: uid(),
            word: item.word,
            translation: item.translation,
            notes: item.notes,
            sectionIds: sectionIds,
            box: importedBox,
            reviewed: typeof item.reviewed === "boolean" ? item.reviewed : importedBox > 0,
            // A box-0 card is "New" - never studied - and has no
            // legitimate reason to carry a future due date, so any
            // provided dueAt only applies once a card has actually
            // graduated past box 0.
            dueAt: importedBox > 0 && typeof item.dueAt === "number" ? item.dueAt : Date.now(),
            createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now()
          };
          cards.push(newCard);
          existingByKey[key] = newCard;
          added++;
        });
        saveData();
        refreshHome();
        alert("Imported " + added + " new card" + (added === 1 ? "" : "s") +
          (incoming.length - added > 0 ? " (" + (incoming.length - added) + " duplicates skipped)" : ""));
      } catch (err) {
        alert("Could not import file: " + err.message);
      }
      document.getElementById("file-import").value = "";
    };
    reader.readAsText(file);
  });

  // ---------- viewport height ----------
  // 100dvh under-reports the true screen height in iOS standalone display
  // mode (it's designed around Safari's own dynamically-appearing toolbar,
  // which doesn't exist once installed to the Home Screen), leaving a gap
  // of plain <body> background below #app that no internal CSS can reach.
  // window.innerHeight reports the real usable height in every mode, so
  // it drives #app's height directly instead.
  //
  // On some Android browsers, window.innerHeight itself shrinks when the
  // on-screen keyboard opens, which would otherwise re-flow #app's flex
  // layout and drag the centered flashcard up with it. appHeightFrozen
  // pauses that recalculation while the type-answer input is focused, so
  // the card stays put and only the floating input/Check bar tracks the
  // keyboard (see positionTypeAnswerBar below).
  var appHeightFrozen = false;
  function setAppHeight() {
    if (appHeightFrozen) return;
    document.documentElement.style.setProperty("--app-height", window.innerHeight + "px");
  }
  setAppHeight();
  window.addEventListener("resize", setAppHeight);
  window.addEventListener("orientationchange", setAppHeight);
  window.addEventListener("pageshow", setAppHeight);

  // ---------- type-answer bar follows the keyboard, card stays put ----------
  // iOS pans/scrolls the whole page to bring a focused field above the
  // keyboard, even when that field is position:fixed - which is what was
  // dragging the header and card up too, and occasionally left the page
  // stuck mid-pan (a blank/black strip of plain <body>) after the keyboard
  // closed. Forcing scroll back to 0 on every visualViewport change cancels
  // that native pan; the bar's own position is then driven purely by our
  // own bottom-offset below, based on how much the keyboard covers.
  var typeAnswerInputEl = document.getElementById("type-answer-input");
  var studyViewEl = document.getElementById("view-study");

  function cancelViewportPan() {
    if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
    if (studyViewEl.scrollTop !== 0) studyViewEl.scrollTop = 0;
  }

  function positionTypeAnswerBar() {
    var bar = document.getElementById("type-answer-bar");
    if (!window.visualViewport || bar.classList.contains("hidden")) return;
    cancelViewportPan();
    var vv = window.visualViewport;
    var overlap = window.innerHeight - vv.height - vv.offsetTop;
    bar.style.bottom = overlap > 0 ? overlap + "px" : "";
    nudgeCardWordAboveBar(bar);
  }

  // If the floating bar rises high enough to cover the card's word (a tall
  // keyboard on a short screen), nudge just the word text up above it - the
  // card itself stays put, only its text shifts, and it settles back to its
  // default position once the bar isn't overlapping it anymore.
  function nudgeCardWordAboveBar(bar) {
    var wordEl = document.getElementById("card-word");
    var frontEl = wordEl.parentElement; // .card-front, centers the word via flex and is never itself transformed pre-flip
    var barTop = bar.getBoundingClientRect().top;
    // Derive the word's natural (untransformed) bottom edge from its parent's
    // stable centered layout instead of measuring the word element itself -
    // its own rect reflects whatever transform (and, with the transition on
    // .card-word, whatever mid-animation position) was already applied,
    // which made each correction chase a moving target instead of the true
    // natural position. The word's own height is unaffected by its
    // translateY though, so combining that with the parent's rect is exact.
    var frontRect = frontEl.getBoundingClientRect();
    var wordHeight = wordEl.getBoundingClientRect().height;
    var naturalBottom = frontRect.top + frontRect.height / 2 + wordHeight / 2;
    var overlap = naturalBottom + 8 - barTop;
    wordEl.style.transform = overlap > 0 ? "translateY(-" + overlap + "px)" : "";
  }

  // Relying only on visualViewport's resize/scroll events proved unreliable
  // on refocus (a second tap into the input after it had already lost focus
  // once could leave the bar stuck at its resting position, hidden behind
  // the keyboard). Polling every frame while focused sidesteps that timing
  // quirk entirely - positionTypeAnswerBar() is cheap arithmetic, so this
  // costs nothing once the loop stops on blur.
  var typeAnswerPositionRaf = null;
  function pollTypeAnswerBarPosition() {
    positionTypeAnswerBar();
    typeAnswerPositionRaf = requestAnimationFrame(pollTypeAnswerBarPosition);
  }

  typeAnswerInputEl.addEventListener("focus", function () {
    appHeightFrozen = true;
    if (typeAnswerPositionRaf) cancelAnimationFrame(typeAnswerPositionRaf);
    pollTypeAnswerBarPosition();
  });
  typeAnswerInputEl.addEventListener("blur", function () {
    if (typeAnswerPositionRaf) {
      cancelAnimationFrame(typeAnswerPositionRaf);
      typeAnswerPositionRaf = null;
    }
    appHeightFrozen = false;
    setAppHeight();
    cancelViewportPan();
    document.getElementById("type-answer-bar").style.bottom = "";
    document.getElementById("card-word").style.transform = "";
  });

  // ---------- install banner (iOS manual steps / Android native prompt) ----------
  var INSTALL_DISMISSED_KEY = "installBannerDismissed";
  var deferredInstallPrompt = null;

  function isStandaloneMode() {
    return window.navigator.standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches;
  }

  function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent); }
  function isAndroid() { return /android/i.test(navigator.userAgent); }

  function showInstallBanner(kind) {
    if (isStandaloneMode() || localStorage.getItem(INSTALL_DISMISSED_KEY)) return;

    var textEl = document.getElementById("install-banner-text");
    var actionBtn = document.getElementById("btn-install-banner-action");

    if (kind === "prompt") {
      textEl.innerHTML = "Install this app for the full experience";
      actionBtn.classList.remove("hidden");
    } else if (kind === "ios") {
      textEl.innerHTML = "📤 Tap <b>Share</b>, then <b>Add to Home Screen</b> for the full app experience";
      actionBtn.classList.add("hidden");
    } else if (kind === "android-manual") {
      textEl.innerHTML = "Tap <b>⋮ menu</b>, then <b>Add to Home screen</b> for the full app experience";
      actionBtn.classList.add("hidden");
    } else {
      return;
    }
    document.getElementById("install-banner").classList.remove("hidden");
  }

  function dismissInstallBanner() {
    localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
    document.getElementById("install-banner").classList.add("hidden");
  }

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredInstallPrompt = e;
    showInstallBanner("prompt");
  });

  document.getElementById("btn-install-banner-action").addEventListener("click", function () {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      deferredInstallPrompt.userChoice.finally(function () { deferredInstallPrompt = null; });
    }
    dismissInstallBanner();
  });

  document.getElementById("btn-install-banner-close").addEventListener("click", dismissInstallBanner);

  // Chrome/Android fires beforeinstallprompt asynchronously; give it a beat
  // before falling back to manual per-platform instructions (iOS never
  // fires it at all - there's no native install prompt API in Safari).
  setTimeout(function () {
    if (deferredInstallPrompt || isStandaloneMode()) return;
    if (isIOS()) showInstallBanner("ios");
    else if (isAndroid()) showInstallBanner("android-manual");
  }, 1500);

  // ---------- service worker ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("service-worker.js").catch(function () {});
    });
  }

  // ---------- backup reminder ----------
  function maybePromptBackup() {
    if (cards.length === 0) return;
    var weekMs = 7 * 86400000;
    if (lastExportAt && Date.now() - lastExportAt < weekMs) return;
    var msg = lastExportAt
      ? "It's been a week since your last backup. Export your cards and progress now?"
      : "You haven't backed up your cards yet. Export now?";
    if (confirm(msg)) performExport();
  }

  // ---------- init ----------
  refreshHome();
  showView("home");
  // confirm() blocks the main thread and can fire before the browser has
  // painted anything - a short delay lets the home screen actually render
  // first instead of a black screen holding until the dialog is dismissed.
  setTimeout(maybePromptBackup, 400);
})();
