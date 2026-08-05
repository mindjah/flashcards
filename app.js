(function () {
  "use strict";

  var STORAGE_KEY = "esCards";
  var BOX_INTERVALS_DAYS = [0, 1, 3, 7, 16, 35]; // index = box number, box0 = due immediately
  var MAX_BOX = BOX_INTERVALS_DAYS.length - 1;

  // ---------- storage ----------
  function defaultStreak() {
    return { current: 0, lastDate: null };
  }

  function loadData() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { cards: [], sections: [], streak: defaultStreak(), lastExportAt: null, lastStudyPrefs: null };
      var parsed = JSON.parse(raw);
      // migrate from the old format where the key held a bare cards array
      if (Array.isArray(parsed)) {
        parsed.forEach(function (c) {
          if (!Array.isArray(c.sectionIds)) c.sectionIds = [];
          if (typeof c.reviewed !== "boolean") c.reviewed = c.box > 0;
        });
        return { cards: parsed, sections: [], streak: defaultStreak(), lastExportAt: null, lastStudyPrefs: null };
      }
      var loadedCards = Array.isArray(parsed.cards) ? parsed.cards : [];
      loadedCards.forEach(function (c) {
        if (!Array.isArray(c.sectionIds)) c.sectionIds = [];
        if (typeof c.reviewed !== "boolean") c.reviewed = c.box > 0;
      });
      var loadedStreak = parsed.streak && typeof parsed.streak.current === "number" ? parsed.streak : defaultStreak();
      return {
        cards: loadedCards,
        sections: Array.isArray(parsed.sections) ? parsed.sections : [],
        streak: loadedStreak,
        lastExportAt: typeof parsed.lastExportAt === "number" ? parsed.lastExportAt : null,
        lastStudyPrefs: parsed.lastStudyPrefs && typeof parsed.lastStudyPrefs === "object" ? parsed.lastStudyPrefs : null
      };
    } catch (e) {
      console.error("Failed to load data", e);
      return { cards: [], sections: [], streak: defaultStreak(), lastExportAt: null, lastStudyPrefs: null };
    }
  }

  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      cards: cards,
      sections: sections,
      streak: streak,
      lastExportAt: lastExportAt,
      lastStudyPrefs: lastStudyPrefs
    }));
  }

  var initialData = loadData();
  var cards = initialData.cards;
  var sections = initialData.sections;
  var streak = initialData.streak;
  var lastExportAt = initialData.lastExportAt;
  var lastStudyPrefs = initialData.lastStudyPrefs;

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

  function addSection(name) {
    name = name.trim();
    if (!name) return null;
    var existing = sections.find(function (s) { return s.name.toLowerCase() === name.toLowerCase(); });
    if (existing) return existing;
    var section = { id: uid(), name: name, createdAt: Date.now() };
    sections.push(section);
    saveData();
    return section;
  }

  function getOrCreateSectionByName(name) {
    name = name.trim();
    if (!name) return null;
    var existing = sections.find(function (s) { return s.name.toLowerCase() === name.toLowerCase(); });
    if (existing) return existing;
    var section = { id: uid(), name: name, createdAt: Date.now() };
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
    sections: document.getElementById("view-sections")
  };

  function showView(name) {
    Object.keys(views).forEach(function (k) {
      views[k].classList.toggle("hidden", k !== name);
    });
  }

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

  document.addEventListener("click", function (e) {
    if (!document.getElementById("stat-info-popup").classList.contains("hidden") &&
        !e.target.closest("#stat-info-popup") &&
        !e.target.closest(".info-trigger")) {
      hideInfoPopup();
    }
  });

  document.getElementById("view-home").addEventListener("scroll", hideInfoPopup);

  function refreshHome() {
    document.getElementById("stat-due").textContent = dueCards().length;
    document.getElementById("stat-total").textContent = cards.length;
    document.getElementById("stat-streak").textContent = streak.current + " 🔥";

    var m = masteryBreakdown();
    var total = cards.length;
    setMasterySegment("mastery-new", m.fresh, total);
    setMasterySegment("mastery-learning", m.learning, total);
    setMasterySegment("mastery-mastered", m.mastered, total);
    document.getElementById("mastery-new-count").textContent = m.fresh;
    document.getElementById("mastery-learning-count").textContent = m.learning;
    document.getElementById("mastery-mastered-count").textContent = m.mastered;

    renderStrugglingList();
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
    revealIcon.textContent = "👁️";
    right.appendChild(revealIcon);

    item.appendChild(word);
    item.appendChild(right);

    item.addEventListener("click", function () {
      var text = "Translation: " + c.translation + (c.notes ? "\n📝 Note: " + c.notes : "");
      showInfoPopup(item, text);
    });

    return item;
  }

  function recentlyAddedCards() {
    return cards.slice().sort(function (a, b) { return b.createdAt - a.createdAt; }).slice(0, 20);
  }

  var HINT_COLLAPSED_COUNT = 3;
  var strugglingExpanded = false;
  var recentExpanded = false;

  function renderHintSection(listId, toggleId, items, expanded) {
    var list = document.getElementById(listId);
    list.innerHTML = "";
    items.slice(0, expanded ? 20 : HINT_COLLAPSED_COUNT).forEach(function (c) {
      list.appendChild(buildHintRow(c));
    });

    var toggle = document.getElementById(toggleId);
    toggle.classList.toggle("hidden", items.length <= HINT_COLLAPSED_COUNT);
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

  document.getElementById("struggling-toggle").addEventListener("click", function () {
    strugglingExpanded = !strugglingExpanded;
    renderStrugglingList();
    if (strugglingExpanded) {
      document.getElementById("struggling-block").scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      document.getElementById("view-home").scrollTo({ top: 0, behavior: "smooth" });
    }
  });

  document.getElementById("recent-toggle").addEventListener("click", function () {
    recentExpanded = !recentExpanded;
    renderStrugglingList();
    if (recentExpanded) {
      document.getElementById("recent-block").scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      document.getElementById("view-home").scrollTo({ top: 0, behavior: "smooth" });
    }
  });

  function setMasterySegment(id, count, total) {
    var el = document.getElementById(id);
    el.classList.toggle("hidden", count === 0);
    el.style.flexBasis = total > 0 ? (count / total * 100) + "%" : "0%";
  }

  document.getElementById("btn-add").addEventListener("click", function () {
    openAddView(null);
  });

  document.getElementById("btn-manage").addEventListener("click", function () {
    populateManageSectionFilter();
    document.getElementById("manage-mastery-filter").value = "";
    renderManageList();
    showView("manage");
  });

  document.getElementById("btn-manage-sections").addEventListener("click", function () {
    renderSectionsList();
    showView("sections");
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

  // ---------- add / edit card ----------
  var editingId = null;
  var editingSectionIds = [];

  function renderAddSectionsPicker() {
    var list = document.getElementById("add-sections-list");
    list.innerHTML = "";

    sections.forEach(function (s) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip" + (editingSectionIds.indexOf(s.id) !== -1 ? " active" : "");
      chip.textContent = s.name;
      chip.addEventListener("click", function () {
        var idx = editingSectionIds.indexOf(s.id);
        if (idx === -1) {
          editingSectionIds.push(s.id);
        } else {
          editingSectionIds.splice(idx, 1);
        }
        chip.classList.toggle("active");
      });
      list.appendChild(chip);
    });

    var addChip = document.createElement("button");
    addChip.type = "button";
    addChip.className = "chip chip-add";
    addChip.textContent = "+ New card deck";
    addChip.addEventListener("click", function () {
      var name = prompt("New card deck name");
      if (name === null) return;
      name = name.trim();
      if (!name) return;
      var section = addSection(name);
      if (section && editingSectionIds.indexOf(section.id) === -1) {
        editingSectionIds.push(section.id);
      }
      renderAddSectionsPicker();
    });
    list.appendChild(addChip);
  }

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

    renderAddSectionsPicker();
    document.getElementById("save-toast").classList.add("hidden");
    showView("add");
    wordEl.focus();
  }

  document.getElementById("btn-add-translate").addEventListener("click", function () {
    openGoogleTranslate(document.getElementById("input-word").value);
  });

  document.getElementById("btn-add-back").addEventListener("click", function () {
    if (editingId) {
      editingId = null;
      renderManageList(document.getElementById("manage-search").value);
      showView("manage");
    } else {
      refreshHome();
      showView("home");
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
      renderManageList(document.getElementById("manage-search").value);
      showView("manage");
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
    wordEl.focus();

    var toast = document.getElementById("save-toast");
    toast.classList.remove("hidden");
    setTimeout(function () { toast.classList.add("hidden"); }, 1200);
  });

  // ---------- manage ----------
  function populateManageSectionFilter() {
    var sel = document.getElementById("manage-section-filter");
    var current = sel.value;
    sel.innerHTML = "";

    var allOpt = document.createElement("option");
    allOpt.value = "";
    allOpt.textContent = "All card decks";
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

  function renderManageList(filter) {
    var list = document.getElementById("manage-list");
    list.innerHTML = "";

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

    if (items.length === 0) {
      var empty = document.createElement("div");
      empty.className = "manage-empty";
      empty.textContent = cards.length === 0 ? "No cards yet. Add your first one!" : "No matches.";
      list.appendChild(empty);
      return;
    }

    items.forEach(function (c) {
      var row = document.createElement("div");
      row.className = "manage-item";

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

      var names = sectionNames(c);
      if (names.length > 0) {
        var sectionsRow = document.createElement("div");
        sectionsRow.className = "chip-list chip-list-inline";
        names.forEach(function (n) {
          var chip = document.createElement("span");
          chip.className = "chip chip-tag";
          chip.textContent = n;
          sectionsRow.appendChild(chip);
        });
        text.appendChild(sectionsRow);
      }

      var meta = document.createElement("div");
      meta.className = "manage-item-meta";
      var now = Date.now();
      meta.textContent = isDue(c, now) ? "To learn" : "Due " + formatRelative(c.dueAt - now);
      text.appendChild(meta);

      var actions = document.createElement("div");
      actions.className = "manage-item-actions";

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
        renderManageList(document.getElementById("manage-search").value);
      });

      actions.appendChild(edit);
      actions.appendChild(del);

      row.appendChild(text);
      row.appendChild(actions);
      list.appendChild(row);
    });
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
    populateManageSectionFilter();
    document.getElementById("manage-section-filter").value = "";
    document.getElementById("manage-mastery-filter").value = tier;
    document.getElementById("manage-search").value = "";
    renderManageList();
    showView("manage");
  }

  document.querySelectorAll(".mastery-seg, .mastery-legend-item").forEach(function (el) {
    el.addEventListener("click", function () {
      openManageFilteredByMastery(el.dataset.tier);
    });
  });

  document.getElementById("btn-manage-back").addEventListener("click", function () {
    refreshHome();
    showView("home");
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
      row.className = "manage-item";

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

  document.getElementById("form-add-section").addEventListener("submit", function (e) {
    e.preventDefault();
    var input = document.getElementById("input-section-name");
    var name = input.value.trim();
    if (!name) return;
    addSection(name);
    input.value = "";
    renderSectionsList();
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

  document.getElementById("btn-section-picker-all").addEventListener("click", function () {
    studySetupCheckboxes().forEach(function (cb) { cb.checked = true; });
  });

  document.getElementById("btn-section-picker-none").addEventListener("click", function () {
    studySetupCheckboxes().forEach(function (cb) { cb.checked = false; });
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

  document.getElementById("btn-study").addEventListener("click", function () {
    renderStudySetup();
    showView("studySetup");
  });

  // ---------- study session ----------
  var session = { queue: [], current: null, revealed: false, studied: 0, passed: 0, failed: 0, allMode: false, mode: "normal" };

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

  function nextCard() {
    if (session.queue.length === 0) {
      finishStudy();
      return;
    }
    session.current = session.queue.shift();
    session.revealed = false;

    var cardEl = document.getElementById("card");
    cardEl.classList.remove("flipped", "swipe-pass", "swipe-fail");
    cardEl.style.transition = "";
    cardEl.style.transform = "";
    cardEl.style.opacity = "";
    var reversed = session.mode === "reversed";
    document.getElementById("card-word").textContent = reversed ? session.current.translation : session.current.word;
    document.getElementById("card-translation").textContent = reversed ? session.current.word : session.current.translation;

    var hasNote = !!session.current.notes;
    document.getElementById("card-note").classList.toggle("hidden", !hasNote);
    document.getElementById("card-note-text").textContent = hasNote ? session.current.notes : "";

    document.getElementById("tap-hint").textContent = "Tap card to reveal";
    document.getElementById("study-answer-controls").classList.add("hidden");
    updateProgress();
  }

  function updateProgress() {
    var remaining = session.queue.length + 1;
    document.getElementById("study-progress").textContent =
      session.studied + " done · " + remaining + " left";
  }

  function revealCard() {
    if (session.revealed || !session.current) return;
    session.revealed = true;
    document.getElementById("card").classList.add("flipped");
    document.getElementById("tap-hint").textContent = "";
    document.getElementById("study-answer-controls").classList.remove("hidden");
  }

  document.getElementById("card").addEventListener("click", revealCard);

  document.getElementById("btn-pass").addEventListener("click", function () {
    answerCard(true);
  });
  document.getElementById("btn-fail").addEventListener("click", function () {
    answerCard(false);
  });

  document.getElementById("btn-study-translate").addEventListener("click", function () {
    if (session.current) openGoogleTranslate(session.current.word);
  });

  // ---------- swipe to answer ----------
  var SWIPE_THRESHOLD = 90;
  var swipe = null;
  var swipeCardEl = document.getElementById("card");

  swipeCardEl.addEventListener("touchstart", function (e) {
    if (!session.revealed) return;
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
      // requeue later in this session so it comes up again before finishing
      var insertAt = Math.min(session.queue.length, 2 + Math.floor(Math.random() * 3));
      session.queue.splice(insertAt, 0, c);
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

  document.getElementById("btn-empty-back").addEventListener("click", function () {
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
      "#streak-last-date:" + (streak.lastDate || "")
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

    text.split(/\r?\n/).forEach(function (line) {
      if (!line) return;
      if (line.charAt(0) === "#") {
        if (line.indexOf("#streak-current:") === 0) {
          importedStreak = importedStreak || {};
          importedStreak.current = parseInt(line.slice("#streak-current:".length), 10) || 0;
        } else if (line.indexOf("#streak-last-date:") === 0) {
          importedStreak = importedStreak || {};
          importedStreak.lastDate = line.slice("#streak-last-date:".length).trim() || null;
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

    return { items: items, streak: importedStreak };
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

        if (parsed.streak) {
          streak = { current: parsed.streak.current || 0, lastDate: parsed.streak.lastDate || null };
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
            dueAt: typeof item.dueAt === "number" ? item.dueAt : Date.now(),
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
  function setAppHeight() {
    document.documentElement.style.setProperty("--app-height", window.innerHeight + "px");
  }
  setAppHeight();
  window.addEventListener("resize", setAppHeight);
  window.addEventListener("orientationchange", setAppHeight);
  window.addEventListener("pageshow", setAppHeight);

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
