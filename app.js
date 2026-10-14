(function () {
  "use strict";

  var STORAGE_KEY = "esCards";
  var BOX_INTERVALS_DAYS = [0, 1, 3, 7, 16, 35]; // index = box number, box0 = due immediately
  var MAX_BOX = BOX_INTERVALS_DAYS.length - 1;

  // Muted book-cloth colors, shown as each deck's spine - warm enough to
  // sit next to the coffee-brown accent in both light and dark mode.
  var SECTION_COLORS = [
    "#9a6c46", "#6f7d4f", "#a85f48", "#4f6a86", "#7a5a78",
    "#c08a5a", "#4f7d78", "#8a4f5f", "#8a8a4a", "#6b6f9a",
    "#b07a6a", "#5f8a6f"
  ];
  // Decks created before this palette keep their hue - same index in
  // SECTION_COLORS as in these earlier palettes (the original saturated
  // one, the pastel one, then the old-book one).
  var LEGACY_SECTION_PALETTES = [
    ["#f1bf00", "#3ecf8e", "#ff6b6b", "#5b8def", "#c77dff",
     "#ff9f45", "#38d9d9", "#f06595", "#82c91e", "#748ffc",
     "#ffa8a8", "#63e6be"],
    ["#f6d98b", "#a8dcc0", "#f4aaa6", "#a9c4ee", "#cdb4ee",
     "#f8c49a", "#a3dedd", "#f2b1cc", "#c4dd9c", "#b8bff0",
     "#f7c6c0", "#b3e6d3"],
    ["#85603f", "#4f6b45", "#8e3b2f", "#3f5873", "#6a4a6e",
     "#a35a2c", "#3e6c69", "#7d3447", "#6f7a38", "#525d86",
     "#9a5b4c", "#4c7a62"]
  ];

  // The 10 most commonly learned foreign languages - drives the flag icon,
  // the "___ word / phrase" label in Add card, and the Ask Gemini prompt.
  var LANGUAGES = [
    { code: "en", name: "English", flag: "🇬🇧" },
    { code: "es", name: "Spanish", flag: "🇪🇸" },
    { code: "fr", name: "French", flag: "🇫🇷" },
    { code: "de", name: "German", flag: "🇩🇪" },
    { code: "it", name: "Italian", flag: "🇮🇹" },
    { code: "pt", name: "Portuguese", flag: "🇵🇹" },
    { code: "ja", name: "Japanese", flag: "🇯🇵" },
    { code: "ko", name: "Korean", flag: "🇰🇷" },
    { code: "zh", name: "Chinese", flag: "🇨🇳" },
    { code: "ru", name: "Russian", flag: "🇷🇺" },
    { code: "ar", name: "Arabic", flag: "🇸🇦" }
  ];
  var DEFAULT_LANGUAGE_CODE = "es";

  function languageByCode(code) {
    return LANGUAGES.filter(function (l) { return l.code === code; })[0] || LANGUAGES[0];
  }

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
  // A single free-text note, as shown in the Notes tab's grid of cards.
  function normalizeNotesList(rawNotes, legacyNotepad) {
    if (Array.isArray(rawNotes)) {
      return rawNotes
        .filter(function (n) { return n && typeof n.text === "string"; })
        .map(function (n) {
          return {
            id: typeof n.id === "string" ? n.id : uid(),
            text: n.text,
            name: typeof n.name === "string" ? n.name : "",
            updatedAt: typeof n.updatedAt === "number" ? n.updatedAt : Date.now()
          };
        });
    }
    // Pre-multi-note format: a single freeform string becomes one note.
    if (typeof legacyNotepad === "string" && legacyNotepad) {
      return [{ id: uid(), text: legacyNotepad, updatedAt: Date.now() }];
    }
    return [];
  }

  function loadData() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { cards: [], sections: [], lastExportAt: null, lastStudyPrefs: null, notes: [], foreignLanguage: DEFAULT_LANGUAGE_CODE };
      var parsed = JSON.parse(raw);
      // migrate from the old format where the key held a bare cards array
      if (Array.isArray(parsed)) {
        parsed.forEach(function (c) {
          if (!Array.isArray(c.sectionIds)) c.sectionIds = [];
          if (typeof c.reviewed !== "boolean") c.reviewed = c.box > 0;
          if (c.box <= 0 && c.dueAt > Date.now()) c.dueAt = Date.now();
        });
        return { cards: parsed, sections: [], lastExportAt: null, lastStudyPrefs: null, notes: [], foreignLanguage: DEFAULT_LANGUAGE_CODE };
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
        LEGACY_SECTION_PALETTES.forEach(function (palette) {
          var legacyIdx = palette.indexOf(String(s.color).toLowerCase());
          if (legacyIdx !== -1) s.color = SECTION_COLORS[legacyIdx];
        });
        if (!s.color) s.color = randomSectionColor();
      });
      return {
        cards: loadedCards,
        sections: loadedSections,
        lastExportAt: typeof parsed.lastExportAt === "number" ? parsed.lastExportAt : null,
        lastStudyPrefs: parsed.lastStudyPrefs && typeof parsed.lastStudyPrefs === "object" ? parsed.lastStudyPrefs : null,
        notes: normalizeNotesList(parsed.notes, parsed.notepad),
        foreignLanguage: typeof parsed.foreignLanguage === "string" ? parsed.foreignLanguage : DEFAULT_LANGUAGE_CODE
      };
    } catch (e) {
      console.error("Failed to load data", e);
      return { cards: [], sections: [], lastExportAt: null, lastStudyPrefs: null, notes: [], foreignLanguage: DEFAULT_LANGUAGE_CODE };
    }
  }

  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      cards: cards,
      sections: sections,
      lastExportAt: lastExportAt,
      lastStudyPrefs: lastStudyPrefs,
      notes: notesList,
      foreignLanguage: foreignLanguage
    }));
    if (window.FlashcardsDrive) window.FlashcardsDrive.markChanged();
  }

  var initialData = loadData();
  var cards = initialData.cards;
  var sections = initialData.sections;
  var lastExportAt = initialData.lastExportAt;
  var lastStudyPrefs = initialData.lastStudyPrefs;
  var notesList = initialData.notes;
  var currentEditingNote = null;
  var foreignLanguage = initialData.foreignLanguage;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function isDue(card, now) {
    return card.dueAt <= now;
  }

  // ---------- dates ----------
  function pad2(n) { return n < 10 ? "0" + n : "" + n; }

  function dateStr(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function todayStr() { return dateStr(new Date()); }

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
    var webUrl = "https://translate.google.com/?sl=" + foreignLanguage + "&tl=en&text=" + query + "&op=translate";

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
    gemini: document.getElementById("view-gemini"),
    notes: document.getElementById("view-notes-list"),
    noteEditor: document.getElementById("view-notes"),
    drive: document.getElementById("view-drive"),
    settings: document.getElementById("view-settings")
  };

  var TABBAR_VIEWS = { home: true, manage: true, sections: true, notes: true };

  function showView(name) {
    Object.keys(views).forEach(function (k) {
      views[k].classList.toggle("hidden", k !== name);
    });
    // Unhiding a view with a lot of content (Manage cards' full list) forces
    // a heavy layout pass of its own - starting the fade in the very same
    // frame let that layout cost eat into the animation, dropping its first
    // frames and making it look like it barely faded at all. Waiting a
    // frame lets that settle first, so the animation itself always gets a
    // clean run.
    var target = views[name];
    target.classList.remove("view-entering");
    requestAnimationFrame(function () {
      void target.offsetWidth;
      target.classList.add("view-entering");
    });
    if (name === "home") { pulsePracticeIcon(); }
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

  // False only for the very first placement (on initial load, before
  // there's any prior position to animate from) and for the resize
  // handler below (repositioning due to a layout change, not a switch,
  // shouldn't visibly slide) - every real tab switch after that animates.
  var tabbarIndicatorPlacedOnce = false;

  function updateTabbar(name) {
    var show = !!TABBAR_VIEWS[name];
    tabbar.classList.toggle("hidden", !show);
    if (!show) return;
    tabbarButtons.forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.view === name);
    });
    placeTabbarIndicator(tabbarIndicatorPlacedOnce);
    tabbarIndicatorPlacedOnce = true;
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
  }

  var STAT_INFO = {
    "stat-card-due": "To learn: cards that are due for review right now - new cards plus any whose review interval has passed. Tap Practice to work through them.",
    "stat-card-total": "Total cards: every card in your collection, across all card decks."
  };

  Object.keys(STAT_INFO).forEach(function (cardId) {
    var el = document.getElementById(cardId);
    el.addEventListener("click", function () {
      showInfoPopup(el, STAT_INFO[cardId]);
    });
  });

  // Draws the eye to Practice on every home landing - capped to once per
  // 12s so rapid back-and-forth navigation (e.g. editing a card, backing
  // out) doesn't replay it on every single arrival.
  var PRACTICE_PULSE_COOLDOWN_MS = 12000;
  var lastPracticePulseAt = 0;

  function pulsePracticeIcon() {
    if (Date.now() - lastPracticePulseAt < PRACTICE_PULSE_COOLDOWN_MS) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    lastPracticePulseAt = Date.now();
    var icon = document.getElementById("tab-practice-icon");
    icon.classList.remove("pulsing");
    void icon.offsetWidth; // force reflow so the animation restarts if triggered again after removal
    icon.classList.add("pulsing");
    setTimeout(function () { icon.classList.remove("pulsing"); }, 2000);
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
  var cardPreviewCard = null;

  function openCardPreview(c) {
    cardPreviewCard = c;
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
    // Trying this out for Spanish only for now - Web Speech API voice
    // coverage/quality for the other 10 languages hasn't been checked yet.
    document.getElementById("btn-card-preview-speak").classList.toggle("hidden", foreignLanguage !== "es");
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

  // ---------- speak (Spanish only for now) ----------
  // iOS drops a speak() issued right after cancel(), can leave the queue
  // paused, and garbage-collects utterances mid-speech - so only cancel when
  // something's actually playing, resume first, pin an explicit Spanish voice,
  // and keep a reference to the live utterance.
  var currentUtterance = null;
  function pickSpanishVoice() {
    var voices = window.speechSynthesis.getVoices() || [];
    return voices.find(function (v) { return v.lang === "es-ES"; }) ||
           voices.find(function (v) { return /^es[-_]/i.test(v.lang); }) || null;
  }
  if ("speechSynthesis" in window) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener("voiceschanged", function () { window.speechSynthesis.getVoices(); });
  }
  if (navigator.audioSession) {
    try { navigator.audioSession.type = "playback"; } catch (err) {}
  }

  // iOS 27 mutes Web Speech when the ring/silent switch is on silent, and
  // navigator.audioSession alone doesn't change that. Playing a (silent) media
  // element alongside it moves the page into the media-playback audio
  // category, which ignores the switch - so loop a tiny silent WAV while
  // speaking, then stop it once the utterance ends.
  var silentAudioEl = null;
  function silentWavUrl() {
    var sampleRate = 8000, samples = 4000;
    var buf = new ArrayBuffer(44 + samples);
    var v = new DataView(buf);
    function str(o, t) { for (var i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); }
    str(0, "RIFF"); v.setUint32(4, 36 + samples, true); str(8, "WAVE");
    str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    str(36, "data"); v.setUint32(40, samples, true);
    for (var i = 0; i < samples; i++) v.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  }
  function startSilentAudio() {
    if (!silentAudioEl) {
      silentAudioEl = document.createElement("audio");
      silentAudioEl.src = silentWavUrl();
      silentAudioEl.loop = true;
      silentAudioEl.setAttribute("playsinline", "");
      silentAudioEl.setAttribute("x-webkit-airplay", "deny");
    }
    var played = silentAudioEl.play();
    if (played && played.then) {
      played.catch(function () {});
    }
  }
  function stopSilentAudio() {
    if (silentAudioEl) silentAudioEl.pause();
  }

  // The button that triggered the current utterance glows while it speaks.
  var speakingBtn = null;
  function setSpeakingBtn(btn) {
    if (speakingBtn) speakingBtn.classList.remove("speaking");
    speakingBtn = btn || null;
    if (speakingBtn) speakingBtn.classList.add("speaking");
  }

  // iOS 27's on-device Web Speech runs start-to-end in a home-screen app but
  // produces no sound at all, so the primary voice is now Google Translate's
  // TTS played as a regular audio clip (plays reliably, silent switch
  // included). Offline, or if that clip fails, fall back to Web Speech.
  var ttsAudioEl = null;
  var ttsPlayId = 0;
  function speakWord(text, btn) {
    if (!text) return;
    if (!navigator.onLine) { speakWithSynth(text, btn); return; }
    if (!ttsAudioEl) {
      ttsAudioEl = document.createElement("audio");
      ttsAudioEl.setAttribute("playsinline", "");
    }
    var audio = ttsAudioEl;
    audio.pause();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setSpeakingBtn(btn);
    var src = "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=es&q=" + encodeURIComponent(text);
    var playId = ++ttsPlayId;
    var fellBack = false;
    // A re-tap restarts the clip, rejecting the previous play() - only fall
    // back for the tap that's still current.
    function fallback() {
      if (fellBack || playId !== ttsPlayId) return;
      fellBack = true;
      speakWithSynth(text, btn);
    }
    audio.onended = function () { setSpeakingBtn(null); };
    audio.onerror = fallback;
    audio.src = src;
    var played = audio.play();
    if (played && played.catch) played.catch(fallback);
  }

  function speakWithSynth(text, btn) {
    setSpeakingBtn(btn);
    startSilentAudio();
    if (!text || !("speechSynthesis" in window)) { setSpeakingBtn(null); return; }
    var synth = window.speechSynthesis;
    if (navigator.audioSession) {
      try { navigator.audioSession.type = "playback"; } catch (err) {}
    }
    var utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "es-ES";
    var voice = pickSpanishVoice();
    if (voice) utterance.voice = voice;
    utterance.onend = utterance.onerror = function () {
      if (currentUtterance === utterance) {
        stopSilentAudio();
        setSpeakingBtn(null);
        currentUtterance = null;
      }
    };
    currentUtterance = utterance;
    if (synth.speaking || synth.pending) {
      synth.cancel();
      setTimeout(function () { synth.resume(); synth.speak(utterance); }, 60);
    } else {
      synth.resume();
      synth.speak(utterance);
    }
  }

  document.getElementById("btn-card-preview-speak").addEventListener("click", function (e) {
    e.stopPropagation();
    speakWord(document.getElementById("card-preview-word").textContent, this);
  });

  document.getElementById("btn-card-preview-edit").addEventListener("click", function (e) {
    e.stopPropagation();
    if (!cardPreviewCard) return;
    closeCardPreview();
    addReturnTo = "manage";
    openAddView(cardPreviewCard);
  });

  // "To learn"/"Total cards" (now shown on the Manage screen) are global
  // counts unrelated to
  // Manage's own search/filters, so they're refreshed from both here and
  // openManageView() rather than only whenever the home screen updates.
  function updateGlobalStats() {
    document.getElementById("stat-due").textContent = dueCards().length;
    document.getElementById("stat-total").textContent = cards.length;
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
    document.getElementById("mastery-headline").textContent = total
      ? m.mastered + " of " + total + " word" + (total === 1 ? "" : "s") + " mastered"
      : "Your first word is waiting";
    updateHomeSubtitle();

    renderDailyCard();
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
    var el = document.getElementById("daily-card-block");
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
    document.getElementById("btn-daily-card-speak").classList.toggle("hidden", foreignLanguage !== "es");
    var noteEl = document.getElementById("daily-card-note");
    if (card.notes) {
      document.getElementById("daily-card-note-text").textContent = card.notes;
      noteEl.classList.remove("hidden");
    } else {
      noteEl.classList.add("hidden");
    }
  }

  document.getElementById("btn-daily-card-speak").addEventListener("click", function (e) {
    e.stopPropagation();
    speakWord(document.getElementById("daily-card-word").textContent, this);
  });

  document.getElementById("daily-card-inner").addEventListener("click", function () {
    document.getElementById("daily-card").classList.toggle("flipped");
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
    document.getElementById("manage-search").value = "";
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
    showView("settings");
  });

  // ---------- notes ----------
  function renderNotesList() {
    var grid = document.getElementById("notes-grid");
    grid.innerHTML = "";
    // An empty grid still claims its flex:1 share of the view alongside
    // .manage-empty's own flex:1, splitting the space in half instead of
    // leaving the empty message centered in the whole view - hiding it
    // outright (not just leaving it childless) avoids that.
    var hasNotes = notesList.length > 0;
    grid.classList.toggle("hidden", !hasNotes);
    document.getElementById("notes-empty").classList.toggle("hidden", hasNotes);

    notesList.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; }).forEach(function (note) {
      var card = document.createElement("button");
      card.type = "button";
      card.className = "note-card";

      var title = document.createElement("div");
      title.className = "note-card-title";
      title.textContent = note.name || "Note";
      card.appendChild(title);

      var preview = document.createElement("div");
      var text = (note.text || "").trim();
      preview.className = "note-card-preview" + (text ? "" : " note-card-empty");
      preview.textContent = text || "Empty note";
      card.appendChild(preview);

      card.addEventListener("click", function () { openNoteEditor(note); });
      grid.appendChild(card);
    });
  }

  function openNotesView() {
    renderNotesList();
    showView("notes");
  }

  function openNoteEditor(note) {
    currentEditingNote = note;
    document.getElementById("notes-textarea").value = note.text || "";
    document.getElementById("note-editor-title").textContent = note.name || "Note";
    showView("noteEditor");
  }

  document.getElementById("btn-notes-add").addEventListener("click", function () {
    var note = { id: uid(), text: "", name: "", updatedAt: Date.now() };
    notesList.push(note);
    openNoteEditor(note);
  });

  document.getElementById("btn-note-rename").addEventListener("click", function () {
    if (!currentEditingNote) return;
    var newName = prompt("Rename note", currentEditingNote.name || "Note");
    if (newName === null) return;
    currentEditingNote.name = newName.trim();
    document.getElementById("note-editor-title").textContent = currentEditingNote.name || "Note";
    saveData();
  });

  document.getElementById("notes-textarea").addEventListener("input", function () {
    if (!currentEditingNote) return;
    currentEditingNote.text = this.value;
    currentEditingNote.updatedAt = Date.now();
    saveData();
  });

  // A new (or emptied-out) note left blank on the way out is discarded
  // rather than left cluttering the grid as an "Empty note" card.
  function finishEditingNote() {
    if (currentEditingNote) {
      if (!(currentEditingNote.text || "").trim()) {
        var idx = notesList.indexOf(currentEditingNote);
        if (idx !== -1) notesList.splice(idx, 1);
      }
      saveData();
      currentEditingNote = null;
    }
    renderNotesList();
    showView("notes");
  }

  document.getElementById("btn-notes-back").addEventListener("click", finishEditingNote);

  document.getElementById("btn-note-delete").addEventListener("click", function () {
    if (!currentEditingNote) return;
    if (!confirm("Delete this note?")) return;
    var idx = notesList.indexOf(currentEditingNote);
    if (idx !== -1) notesList.splice(idx, 1);
    currentEditingNote = null;
    saveData();
    renderNotesList();
    showView("notes");
  });

  document.getElementById("btn-notes-list-back").addEventListener("click", function () {
    refreshHome();
    showView("home");
  });

  // ---------- settings ----------
  document.getElementById("btn-settings").addEventListener("click", function () {
    renderDrive();
    renderSettingsGeminiKey();
    showView("settings");
  });

  document.getElementById("btn-settings-back").addEventListener("click", function () {
    refreshHome();
    showView("home");
  });

  // ---------- learning language ----------
  // Drives the flag icon, the home subtitle and the "___ word / phrase"
  // label in Add card.
  (function initLanguageSelect() {
    var select = document.getElementById("language-select");
    LANGUAGES.forEach(function (l) {
      var opt = document.createElement("option");
      opt.value = l.code;
      opt.textContent = l.flag + " " + l.name;
      select.appendChild(opt);
    });
    select.value = foreignLanguage;
    select.addEventListener("change", function () {
      foreignLanguage = select.value;
      saveData();
      applyLanguage();
    });
  })();

  // "Your Spanish word book" - the home screen's line under the title.
  function updateHomeSubtitle() {
    document.getElementById("home-subtitle").textContent =
      "Your " + languageByCode(foreignLanguage).name + " word book";
  }

  function applyLanguage() {
    var lang = languageByCode(foreignLanguage);
    updateHomeSubtitle();
    document.getElementById("flag-icon").textContent = lang.flag;
    document.getElementById("input-word-label-text").textContent = lang.name + " word / phrase";
    var select = document.getElementById("language-select");
    if (select.value !== foreignLanguage) select.value = foreignLanguage;
    // Kept in sync here too (not just when a new daily card is rendered) -
    // the settings dropdown only lives on the home screen, so a language
    // change can happen while today's daily card is already showing.
    document.getElementById("btn-daily-card-speak").classList.toggle("hidden", foreignLanguage !== "es");
  }

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

  function autogrow(el) {
    el.style.height = "auto";
    el.style.height = el.scrollHeight + 2 + "px";
  }

  document.getElementById("input-notes").addEventListener("input", function () { autogrow(this); });
  document.getElementById("input-notes").addEventListener("keydown", function (e) {
    // Keep Enter submitting the form like the single-line field it replaced.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      document.getElementById("form-add").requestSubmit();
    }
  });

  function openAddView(cardToEdit, prefillWord) {
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
      wordEl.value = prefillWord || "";
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
    autogrow(notesEl);
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
    if (addReturnTo === "study") {
      session.queue = session.queue.filter(function (c) { return c.id !== target.id; });
      session.reviewQueue = session.reviewQueue.filter(function (c) { return c.id !== target.id; });
      addReturnTo = "manage";
      showView("study");
      nextCard();
    } else {
      addReturnTo = "manage";
      renderManageList(document.getElementById("manage-search").value);
      showView("manage");
    }
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
  // Calls the Gemini API straight from the phone, the way Coffee Shelf does,
  // with the user's own key - asking for JSON in a fixed shape, so the cards
  // go through the same merge as Import, into the named deck.
  var GEMINI_KEY_STORAGE = "flashcards.geminiKey";
  var GEMINI_DEFAULT_MODEL = "gemini-3.8-flash";
  var GEMINI_MAX_WORDS = 100;

  // Coffee Shelf lives on the same origin, so its saved Gemini key (and
  // model choice) can be reused instead of asking for a key twice.
  function coffeeShelfGeminiSettings() {
    try {
      var cs = JSON.parse(localStorage.getItem("coffee-shelf.settings") || "{}");
      return {
        key: typeof cs.geminiKey === "string" ? cs.geminiKey : "",
        model: typeof cs.geminiModel === "string" ? cs.geminiModel : ""
      };
    } catch (e) {
      return { key: "", model: "" };
    }
  }

  function ownGeminiKey() {
    try { return localStorage.getItem(GEMINI_KEY_STORAGE) || ""; } catch (e) { return ""; }
  }

  function saveGeminiKey(key) {
    try {
      if (key) localStorage.setItem(GEMINI_KEY_STORAGE, key);
      else localStorage.removeItem(GEMINI_KEY_STORAGE);
    } catch (e) {}
  }

  function savedGeminiKey() {
    return ownGeminiKey() || coffeeShelfGeminiSettings().key;
  }

  function geminiModelName() {
    return coffeeShelfGeminiSettings().model || GEMINI_DEFAULT_MODEL;
  }

  function geminiUrl(model, method) {
    return "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + method;
  }

  // Settings -> AI: the key Ask Gemini uses. Left empty, Coffee Shelf's
  // key (if any) is used, which the placeholder says.
  function renderSettingsGeminiKey() {
    var input = document.getElementById("settings-gemini-key");
    input.value = ownGeminiKey();
    input.placeholder = coffeeShelfGeminiSettings().key ? "Using Coffee Shelf's key" : "AIza...";
    showSettingsGeminiStatus("", "");
  }

  function showSettingsGeminiStatus(text, tone) {
    var el = document.getElementById("settings-gemini-status");
    el.textContent = text;
    el.className = "settings-status" + (tone ? " settings-status-" + tone : "");
    el.classList.toggle("hidden", !text);
  }

  document.getElementById("btn-settings-gemini-save").addEventListener("click", function () {
    var key = document.getElementById("settings-gemini-key").value.trim();
    saveGeminiKey(key);
    showSettingsGeminiStatus(key ? "Saved ✓"
      : coffeeShelfGeminiSettings().key ? "Cleared - Coffee Shelf's key will be used." : "Cleared.", "ok");
  });

  // A model lookup: checks the key, the model and the connection without
  // spending any generation quota (same check Coffee Shelf does).
  document.getElementById("btn-settings-gemini-test").addEventListener("click", function () {
    var btn = this;
    var key = document.getElementById("settings-gemini-key").value.trim() || savedGeminiKey();
    if (!key) {
      showSettingsGeminiStatus("Enter a key first.", "error");
      return;
    }
    var model = geminiModelName();
    btn.disabled = true;
    showSettingsGeminiStatus("Testing…", "");
    fetch(geminiUrl(model, ""), { headers: { "x-goog-api-key": key } }).catch(function (e) {
      throw geminiNetworkError(e);
    }).then(function (res) {
      if (!res.ok) return readGeminiError(res);
      return res.json().then(function (info) {
        showSettingsGeminiStatus("Connected ✓ " + (info.displayName || model) + " is ready.", "ok");
      });
    }).catch(function (err) {
      showSettingsGeminiStatus(geminiErrorText(err), "error");
    }).then(function () {
      btn.disabled = false;
    });
  });

  var GEMINI_ERRORS = {
    offline: "No internet connection - Gemini can't be reached.",
    dropped: "The connection to Gemini dropped before it answered (twice). Keep the app open while it works and try again.",
    badKey: "Gemini didn't accept this API key. Check it at aistudio.google.com/apikey.",
    rateLimit: "Gemini's free limit is used up for now. Wait a minute and try again.",
    noModel: "This Gemini model isn't available for your key.",
    refusal: "Gemini declined to write this deck. Try a different theme.",
    truncated: "That's too many words for one go - try fewer.",
    unreadable: "Gemini's reply couldn't be read. Try again.",
    api: "Gemini returned an error."
  };

  function GeminiError(kind, detail) {
    this.kind = kind;
    this.detail = detail || "";
  }

  var geminiBusy = false;

  function geminiFormFields() {
    return {
      theme: document.getElementById("gemini-theme"),
      count: document.getElementById("gemini-count"),
      language: document.getElementById("gemini-language"),
      deckName: document.getElementById("gemini-deck-name"),
      key: document.getElementById("gemini-key"),
      send: document.getElementById("btn-gemini-send"),
      error: document.getElementById("gemini-error"),
      status: document.getElementById("gemini-status")
    };
  }

  function updateGeminiSendState() {
    var f = geminiFormFields();
    var count = parseInt(f.count.value, 10);
    var ready = !!f.theme.value.trim() &&
      !!f.language.value.trim() &&
      !!f.deckName.value.trim() &&
      !!f.key.value.trim() &&
      !isNaN(count) && count > 0 && count <= GEMINI_MAX_WORDS;
    f.send.disabled = !ready || geminiBusy;
  }

  function showGeminiError(text) {
    var f = geminiFormFields();
    f.error.textContent = text || "";
    f.error.classList.toggle("hidden", !text);
  }

  function openAskGeminiView() {
    var f = geminiFormFields();
    f.theme.value = "";
    f.count.value = "";
    f.language.value = "";
    f.deckName.value = "";
    f.key.value = savedGeminiKey();
    // Always open at the top, on the theme field - not wherever the form
    // was last scrolled to.
    views.gemini.scrollTop = 0;
    // Only ask for a key here when Settings doesn't have one yet.
    var hasKey = !!f.key.value;
    document.getElementById("gemini-key-field").classList.toggle("hidden", hasKey);
    document.getElementById("gemini-key-hint").classList.toggle("hidden", hasKey);
    document.getElementById("gemini-key-note").classList.toggle("hidden", !hasKey);
    showGeminiError("");
    updateGeminiSendState();
    showView("gemini");
    views.gemini.scrollTop = 0;
    f.theme.focus({ preventScroll: true });
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

  ["gemini-theme", "gemini-language", "gemini-deck-name", "gemini-key"].forEach(function (id) {
    document.getElementById(id).addEventListener("input", updateGeminiSendState);
  });

  // avoid: words earlier batches of the same deck already produced.
  function buildGeminiPrompt(theme, count, language, avoid) {
    var foreignName = languageByCode(foreignLanguage).name;
    return "Create exactly " + count + " " + foreignName + " vocabulary flashcards about the theme \"" + theme + "\". " +
      "For each card give the " + foreignName + " word or phrase (with its article if it's a noun), its translation into " + language + ", " +
      "and a note with how the word is pronounced and one example sentence in " + foreignName + " showing how it's used, " +
      "followed by that sentence's translation into " + language + " in brackets. " +
      "Pick common, useful words and don't repeat any." +
      (avoid && avoid.length ? " These words are already in the deck, so don't use them again: " + avoid.join(", ") + "." : "");
  }

  // Gemini thinks before it writes and sends nothing meanwhile, and iOS
  // drops a connection that stays quiet for about a minute. So a deck is
  // asked for in small batches (each answer comes back quickly), with low
  // thinking and streamed thought summaries (which keep data flowing; the
  // summaries themselves are skipped). A model that rejects a thinking
  // setting (400 mentioning "thinking") falls through to the next option.
  var GEMINI_BATCH_SIZE = 10;
  var GEMINI_THINKING_OPTIONS = [
    { thinkingLevel: "low", includeThoughts: true },
    { includeThoughts: true },
    null
  ];
  var geminiThinkingIndex = 0;

  var GEMINI_CARDS_SCHEMA = {
    type: "object",
    properties: {
      cards: {
        type: "array",
        items: {
          type: "object",
          properties: {
            word: { type: "string" },
            translation: { type: "string" },
            note: { type: "string" }
          },
          required: ["word", "translation", "note"]
        }
      }
    },
    required: ["cards"]
  };

  // Google's error body -> one of GEMINI_ERRORS' kinds.
  function geminiErrorKind(status, body) {
    var err = (body && body.error) || {};
    var reasons = (err.details || []).map(function (d) { return d.reason || ""; }).join(" ");
    if (status === 429) return "rateLimit";
    if (status === 401 || status === 403 || /API_KEY_INVALID/.test(reasons) || /api key/i.test(err.message || "")) return "badKey";
    if (status === 404) return "noModel";
    return "api";
  }

  // No response at all: offline, or a connection that dropped mid-answer -
  // iOS gives up on a connection that stays quiet for about a minute, and
  // on any request once the app goes to the background.
  function geminiNetworkError(e) {
    return new GeminiError(navigator.onLine === false ? "offline" : "dropped", (e && e.message) || "");
  }

  function readGeminiError(res) {
    return res.text().catch(function () { return ""; }).then(function (text) {
      var body = {};
      try { body = JSON.parse(text); } catch (e) {}
      if (Array.isArray(body)) body = body[0] || {};
      throw new GeminiError(geminiErrorKind(res.status, body), (res.status + " " + ((body.error && body.error.message) || "")).trim());
    });
  }

  function geminiErrorText(err) {
    var kind = err instanceof GeminiError ? err.kind : "api";
    var detail = err instanceof GeminiError ? err.detail : (err && err.message) || "";
    var showDetail = (kind === "api" || kind === "dropped" || kind === "offline") && detail;
    return GEMINI_ERRORS[kind] + (showDetail ? " (" + detail.slice(0, 160) + ")" : "");
  }

  // Server-sent events: one "data: {...}" chunk per event, each carrying the
  // next slice of the answer. Reading them as they arrive keeps data flowing
  // while Gemini writes, so a long deck doesn't look like a dead connection.
  function readGeminiStream(res) {
    var out = { text: "", finishReason: "", blocked: false };

    function handleEvent(data) {
      var chunk;
      try { chunk = JSON.parse(data); } catch (e) { return; }
      if (chunk.error) throw new GeminiError(geminiErrorKind(chunk.error.code || 0, chunk), chunk.error.message || "");
      if (chunk.promptFeedback && chunk.promptFeedback.blockReason) out.blocked = true;
      var candidate = (chunk.candidates || [])[0];
      if (!candidate) return;
      ((candidate.content && candidate.content.parts) || []).forEach(function (part) {
        if (part.text && !part.thought) out.text += part.text;
      });
      if (candidate.finishReason) out.finishReason = candidate.finishReason;
    }

    // Handles every complete event in buf; returns the unfinished rest.
    function handleBuffer(buf) {
      var events = buf.replace(/\r\n/g, "\n").split("\n\n");
      var rest = events.pop();
      events.forEach(function (event) {
        var data = event.split("\n")
          .filter(function (line) { return line.indexOf("data:") === 0; })
          .map(function (line) { return line.slice(5).trim(); })
          .join("");
        if (data) handleEvent(data);
      });
      return rest;
    }

    if (!res.body || !res.body.getReader) {
      return res.text().then(function (text) { handleBuffer(text + "\n\n"); return out; });
    }
    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buffer = "";
    function pump() {
      return reader.read().then(function (step) {
        if (step.done) {
          handleBuffer(buffer + decoder.decode() + "\n\n");
          return out;
        }
        buffer = handleBuffer(buffer + decoder.decode(step.value, { stream: true }));
        return pump();
      });
    }
    return pump().catch(function (e) {
      if (e instanceof GeminiError) throw e;
      throw geminiNetworkError(e);
    });
  }

  function askGeminiForCards(key, prompt) {
    var generationConfig = {
      responseMimeType: "application/json",
      responseJsonSchema: GEMINI_CARDS_SCHEMA,
      maxOutputTokens: 16000
    };
    var thinking = GEMINI_THINKING_OPTIONS[geminiThinkingIndex];
    if (thinking) generationConfig.thinkingConfig = thinking;
    return fetch(geminiUrl(geminiModelName(), ":streamGenerateContent?alt=sse"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: generationConfig
      })
    }).catch(function (e) {
      throw geminiNetworkError(e);
    }).then(function (res) {
      if (!res.ok) return readGeminiError(res);
      return readGeminiStream(res);
    }).then(function (answer) {
      if (answer.blocked) throw new GeminiError("refusal");
      if (answer.finishReason === "MAX_TOKENS") throw new GeminiError("truncated");
      if (answer.finishReason === "SAFETY" || answer.finishReason === "PROHIBITED_CONTENT") throw new GeminiError("refusal");
      var parsed;
      try { parsed = JSON.parse(answer.text); } catch (e) { throw new GeminiError("unreadable"); }
      var list = (parsed && Array.isArray(parsed.cards) ? parsed.cards : []).filter(function (c) {
        return c && typeof c.word === "string" && c.word.trim() && typeof c.translation === "string" && c.translation.trim();
      });
      if (!list.length) throw new GeminiError("unreadable");
      return list;
    }).catch(function (err) {
      if (err instanceof GeminiError && err.kind === "api" && /thinking/i.test(err.detail) &&
          geminiThinkingIndex < GEMINI_THINKING_OPTIONS.length - 1) {
        geminiThinkingIndex++;
        return askGeminiForCards(key, prompt);
      }
      throw err;
    });
  }

  // Asks for the deck GEMINI_BATCH_SIZE words at a time, telling each batch
  // what earlier ones produced. A dropped batch is retried once. On failure
  // the error carries .partial - the words made so far - so they aren't lost.
  function createDeckInBatches(key, theme, total, language, onProgress) {
    var made = [];
    var seen = {};
    function nextBatch(attempt) {
      var remaining = total - made.length;
      if (remaining <= 0) return Promise.resolve(made);
      var size = Math.min(GEMINI_BATCH_SIZE, remaining);
      var prompt = buildGeminiPrompt(theme, size, language, made.map(function (c) { return c.word.trim(); }));
      return askGeminiForCards(key, prompt).then(function (list) {
        var fresh = list.filter(function (c) {
          var k = c.word.trim().toLowerCase();
          if (seen[k]) return false;
          seen[k] = true;
          return true;
        }).slice(0, size);
        // Nothing new came back - stop rather than ask forever.
        if (!fresh.length) return made;
        made = made.concat(fresh);
        onProgress(made.length);
        return nextBatch(0);
      }, function (err) {
        if (err instanceof GeminiError && err.kind === "dropped" && attempt < 1) return nextBatch(attempt + 1);
        err.partial = made;
        throw err;
      });
    }
    return nextBatch(0);
  }

  document.getElementById("form-gemini").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = geminiFormFields();
    if (f.send.disabled || geminiBusy) return;
    var key = f.key.value.trim();
    var deckName = f.deckName.value.trim();
    var total = parseInt(f.count.value, 10);
    var progressEl = document.getElementById("gemini-progress");

    geminiBusy = true;
    showGeminiError("");
    f.send.textContent = "Creating deck…";
    // A running clock and word count, so a long deck visibly isn't stuck.
    var startedAt = Date.now();
    var madeSoFar = 0;
    function tick() {
      f.status.textContent = "Gemini is writing your deck… " + madeSoFar + " of " + total + " words · " +
        Math.round((Date.now() - startedAt) / 1000) + "s";
    }
    tick();
    var ticker = setInterval(tick, 1000);
    progressEl.classList.remove("hidden");
    updateGeminiSendState();

    function addToDeck(list, problem) {
      if (key !== coffeeShelfGeminiSettings().key) saveGeminiKey(key);
      var deck = getOrCreateSectionByName(deckName);
      var added = mergeIncomingCards(list.map(function (c) {
        return {
          word: c.word.trim(),
          translation: c.translation.trim(),
          notes: typeof c.note === "string" ? c.note.trim() : "",
          sectionNamesList: [deck.name]
        };
      }));
      saveData();
      refreshHome();
      openManageForSection(deck.id);
      var skipped = list.length - added;
      // After the Cards screen has painted, not over the form.
      setTimeout(function () {
        alert("Added " + added + " new card" + (added === 1 ? "" : "s") + " to “" + deck.name + "”" +
          (skipped > 0 ? " (" + skipped + " you already had joined the deck)" : "") + "." +
          (problem ? "\n\nGemini stopped after " + list.length + " of " + total + " words: " + problem : ""));
      }, 300);
    }

    createDeckInBatches(key, f.theme.value.trim(), total, f.language.value.trim(), function (count) {
      madeSoFar = count;
      tick();
    }).then(function (list) {
      addToDeck(list, "");
    }).catch(function (err) {
      if (err && err.partial && err.partial.length) {
        addToDeck(err.partial, geminiErrorText(err));
      } else {
        showGeminiError(geminiErrorText(err));
      }
    }).then(function () {
      clearInterval(ticker);
      geminiBusy = false;
      f.send.textContent = "Create deck";
      progressEl.classList.add("hidden");
      updateGeminiSendState();
    });
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
    openAddView(null, document.getElementById("manage-search").value.trim());
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

  // Case- and accent-insensitive: "o" matches "ó", "n" matches "ñ", etc.
  function foldForSearch(str) {
    return (str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }

  function renderManageList(filter) {
    document.getElementById("btn-manage-search-clear").classList.toggle("hidden", !document.getElementById("manage-search").value);
    var list = document.getElementById("manage-list");
    list.innerHTML = "";
    openManageSwipeRow = null;

    var sectionFilterVal = document.getElementById("manage-section-filter").value;
    var masteryFilterVal = document.getElementById("manage-mastery-filter").value;

    var items = cards.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    if (filter) {
      var f = foldForSearch(filter);
      items = items.filter(function (c) {
        return foldForSearch(c.word).indexOf(f) !== -1 ||
               foldForSearch(c.translation).indexOf(f) !== -1;
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

      // Floated and placed before the word/translation in the markup, so
      // a long word's text wraps around it (onto a second line) instead
      // of running underneath it in the card's upper-right corner.
      var deckRefs = sectionRefs(c);
      if (deckRefs.length > 0) {
        var sectionsRow = document.createElement("div");
        sectionsRow.className = "chip-list manage-item-decks";
        deckRefs.forEach(function (s) {
          var chip = document.createElement("span");
          chip.className = "chip chip-tag";
          chip.textContent = s.name;
          applyDeckTint(chip, s.color);
          sectionsRow.appendChild(chip);
        });
        text.appendChild(sectionsRow);
      }

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

      var meta = document.createElement("div");
      meta.className = "manage-item-due";
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
          if (row._suppressClick) { row._suppressClick = false; return; }
          if (openManageSwipeRow === row) { closeManageSwipeRow(); return; }
          openCardPreview(c);
        });

        swipeWrap.appendChild(actionsPanel);
        swipeWrap.appendChild(row);
        attachManageSwipe(row, actionsPanel);
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
      if (openManageSwipeRow._swipeActions) openManageSwipeRow._swipeActions.classList.remove("visible");
      openManageSwipeRow = null;
    }
  }

  // Plain absolute positioning, not a flex row sized by overflowing
  // children - that overflow-based layout depended on how a browser
  // resolves a percentage width against a flex container whose own size
  // is determined by its (deliberately overflowing) children, which isn't
  // handled consistently everywhere. Bleed-through of the actions panel
  // through the row's translucent glass is instead prevented with an
  // explicit visibility toggle - not opacity, not z-order, so nothing
  // about the row's own transparency can ever let it show through.
  function attachManageSwipe(rowEl, actionsEl) {
    var startX = 0, startY = 0, dx = 0, dragging = false, isSwipe = false, baseOffset = 0;
    rowEl._swipeActions = actionsEl;

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
      if (!isSwipe && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
        isSwipe = true;
        actionsEl.classList.add("visible");
      }
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
        actionsEl.classList.remove("visible");
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

  document.getElementById("btn-manage-search-clear").addEventListener("click", function () {
    var input = document.getElementById("manage-search");
    input.value = "";
    renderManageList("");
    input.focus();
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
      row.addEventListener("click", function () {
        if (row._suppressClick) { row._suppressClick = false; return; }
        if (openManageSwipeRow === row) { closeManageSwipeRow(); return; }
        openManageForSection(s.id);
      });

      var text = document.createElement("div");
      text.className = "manage-item-text";

      var name = document.createElement("div");
      name.className = "manage-item-word";
      name.textContent = s.name;
      text.appendChild(name);

      var meta = document.createElement("div");
      meta.className = "manage-item-count";
      meta.textContent = count + " card" + (count === 1 ? "" : "s");

      var swipeWrap = document.createElement("div");
      swipeWrap.className = "manage-item-swipe";

      var actionsPanel = document.createElement("div");
      actionsPanel.className = "manage-item-swipe-actions";

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

      actionsPanel.appendChild(rename);
      actionsPanel.appendChild(del);

      row.appendChild(text);
      row.appendChild(meta);

      swipeWrap.appendChild(actionsPanel);
      swipeWrap.appendChild(row);
      attachManageSwipe(row, actionsPanel);
      list.appendChild(swipeWrap);
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

  // Keeps the position bar under the mode carousel in sync with however
  // far the user has scrolled it - a continuous bar rather than one dot
  // per mode, so it doesn't need to change shape as modes are added.
  function updateModePickerTrack() {
    var track = document.getElementById("mode-picker");
    var thumb = document.getElementById("mode-picker-thumb");
    var scrollWidth = track.scrollWidth;
    var clientWidth = track.clientWidth;
    if (scrollWidth <= clientWidth) {
      thumb.style.width = "100%";
      thumb.style.left = "0%";
      return;
    }
    var widthPct = (clientWidth / scrollWidth) * 100;
    var maxScroll = scrollWidth - clientWidth;
    var leftPct = (track.scrollLeft / maxScroll) * (100 - widthPct);
    thumb.style.width = widthPct + "%";
    thumb.style.left = leftPct + "%";
  }

  document.getElementById("mode-picker").addEventListener("scroll", updateModePickerTrack);

  document.querySelectorAll("#mode-picker .chip").forEach(function (btn) {
    btn.addEventListener("click", function () {
      currentStudyMode = btn.dataset.mode;
      renderModePicker();
      // Wait for the newly-active chip's 10% scale-up transition (200ms,
      // matching .mode-picker .chip's own transition) to finish before
      // measuring where it now sits - scrolling immediately would measure
      // its pre-scale size and leave the grown edge just outside view.
      setTimeout(function () {
        btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
      }, 200);
    });
  });

  function renderStudySetup() {
    renderModePicker();

    // The carousel and its position bar can only be measured/scrolled
    // correctly once the view is actually visible (showView runs right
    // after this), so this part waits a frame.
    requestAnimationFrame(function () {
      var active = document.querySelector("#mode-picker .chip.active");
      if (active) active.scrollIntoView({ block: "nearest", inline: "center" });
      updateModePickerTrack();
    });

    var prefSectionIds = lastStudyPrefs ? lastStudyPrefs.sectionIds : null;
    var prefIncludeUnsectioned = lastStudyPrefs ? lastStudyPrefs.includeUnsectioned : true;

    var list = document.getElementById("section-picker-list");
    list.innerHTML = "";

    sections.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (s) {
      var count = cards.filter(function (c) { return c.sectionIds.indexOf(s.id) !== -1; }).length;
      var checked = prefSectionIds ? prefSectionIds.indexOf(s.id) !== -1 : true;
      list.appendChild(buildSectionPickerRow(s.id, s.name, count, checked, s.color));
    });

    var unsectionedCount = cards.filter(function (c) { return c.sectionIds.length === 0; }).length;
    list.appendChild(buildSectionPickerRow("unsectioned", "No card deck", unsectionedCount, prefIncludeUnsectioned));

    updateStudyStartState();
  }

  function buildSectionPickerRow(value, label, count, checked, color) {
    var row = document.createElement("label");
    row.className = "section-picker-row";

    var checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = value;
    checkbox.checked = checked;

    var text = document.createElement("span");
    text.className = "section-picker-row-label";
    text.textContent = label + " (" + count + ")";

    row.appendChild(checkbox);
    row.appendChild(text);

    if (color) {
      var bookmark = document.createElement("span");
      bookmark.className = "deck-bookmark";
      bookmark.style.background = color;
      row.appendChild(bookmark);
    }

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
    document.getElementById("view-study").classList.toggle("match-mode", session.mode === "match");
    showView("study");
    if (session.mode === "match") {
      startMatchSession();
    } else {
      nextCard();
    }
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
  // Split front/back so nextCard() can update the (currently hidden, about
  // to become visible) front face right away while delaying the back
  // face's update - see the comment in nextCard() for why.
  function updateStudyCardFrontContent() {
    var reversed = session.mode === "reversed" || session.mode === "type";
    document.getElementById("card-word").textContent = reversed ? session.current.translation : session.current.word;
    // The foreign word sits on whichever face actually shows it for this
    // mode - front in "normal", back in "reversed"/"type" (never front
    // there, so hearing it can't double as a free answer before revealing).
    var isEs = foreignLanguage === "es";
    document.getElementById("btn-card-front-speak").classList.toggle("hidden", !(isEs && session.mode === "normal"));
  }

  function updateStudyCardBackContent() {
    var reversed = session.mode === "reversed" || session.mode === "type";
    document.getElementById("card-translation").textContent = reversed ? session.current.word : session.current.translation;

    var hasNote = !!session.current.notes;
    document.getElementById("card-note").classList.toggle("hidden", !hasNote);
    document.getElementById("card-note-text").textContent = hasNote ? session.current.notes : "";
    document.getElementById("card-your-answer").classList.add("hidden");

    var isEs = foreignLanguage === "es";
    document.getElementById("btn-card-back-speak").classList.toggle("hidden", !(isEs && reversed));
  }

  // Only resumeStudyAfterEdit() (editing mid-lesson) uses this combined
  // form - there's no flip transition running then, so updating both
  // faces at once is safe.
  function updateStudyCardContent() {
    updateStudyCardFrontContent();
    updateStudyCardBackContent();
  }

  // Keep in sync with the page turn's duration in styles.css.
  var PAGE_TURN_MS = 600;
  var pendingBackContentTimer = null;

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
    // The back page (showing what was just answered) stays uncovered until
    // the front page has turned all the way back down over it (the 0.6s
    // page turn in styles.css). Updating its content immediately flashed the
    // next card's answer on it; the front page updates right away.
    var wasFlipped = cardEl.classList.contains("flipped");
    cardEl.classList.remove("flipped", "swipe-pass", "swipe-fail", "answer-correct", "answer-incorrect");
    cardEl.style.transition = "";
    cardEl.style.transform = "";
    cardEl.style.opacity = "";
    var cardWordEl = document.getElementById("card-word");
    cardWordEl.style.transform = "";
    updateStudyCardFrontContent();
    clearTimeout(pendingBackContentTimer);
    if (wasFlipped) {
      pendingBackContentTimer = setTimeout(updateStudyCardBackContent, PAGE_TURN_MS + 20);
    } else {
      updateStudyCardBackContent();
    }

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
  // Latin letter generically, across whichever language is selected) and
  // of exclamation/question marks, so typing without that language's own
  // keyboard still counts as correct.
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
    // Turned again before the previous page settled: show this card's
    // answer now rather than when the delayed update lands.
    if (pendingBackContentTimer) {
      clearTimeout(pendingBackContentTimer);
      pendingBackContentTimer = null;
      updateStudyCardBackContent();
    }
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
    if (session.mode === "type" || session.mode === "match") return;
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

  [document.getElementById("btn-card-front-speak"), document.getElementById("btn-card-back-speak")].forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (session.current) speakWord(session.current.word, btn);
    });
    btn.addEventListener("touchstart", function (e) {
      e.stopPropagation();
    }, { passive: true });
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

  // Shared by answerCard() (one card at a time) and Match the words'
  // advanceMatchBatch() (up to 5 resolved at once, after the whole board is
  // cleared) - same box/dueAt/requeue bookkeeping either way, just without
  // the single-card mode's immediate nextCard() advance.
  function resolveStudyCard(c, passed) {
    session.studied++;

    // Match the words is a lightweight warm-up, not a real recall test -
    // it draws from the same due cards but must never touch their box/
    // dueAt/reviewed state, so it can't mark a word "learnt" (or "missed")
    // in the spaced-repetition schedule the other modes maintain.
    var affectsSchedule = session.mode !== "match";
    if (affectsSchedule) c.reviewed = true;

    if (passed) {
      session.passed++;
      if (affectsSchedule) {
        c.box = Math.min(c.box + 1, MAX_BOX);
        c.dueAt = Date.now() + BOX_INTERVALS_DAYS[c.box] * 86400000;
      }
    } else {
      session.failed++;
      if (affectsSchedule) {
        c.box = 0;
        c.dueAt = Date.now();
      }
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
  }

  function answerCard(passed) {
    var c = session.current;
    if (!c) return;
    resolveStudyCard(c, passed);
    saveData();
    nextCard();
  }

  // ---------- Match the words ----------
  // Deals two boards at once, one per flashcard face - the inactive face is
  // pre-populated with the *next* batch before the flip happens, so the
  // flip reveals an already-ready board instead of a flash of stale/empty
  // content. Which face is "live" is derived from the card's own .flipped
  // class (front = not flipped) rather than tracked separately, so it can
  // never drift out of sync with what's actually on screen.
  var MATCH_BATCH_SIZE = 5;
  var MATCH_FLASH_MS = 300;
  var MATCH_VANISH_MS = 300;
  var matchBoards = { front: [], back: [] };
  var matchSelected = null;

  function drawMatchCards(n) {
    var out = [];
    while (out.length < n) {
      if (session.queue.length === 0) {
        if (session.reviewQueue.length === 0) break;
        session.queue = session.reviewQueue;
        session.reviewQueue = [];
        session.inReview = true;
      }
      out.push(session.queue.shift());
    }
    document.getElementById("study-review-label").classList.toggle("hidden", !session.inReview);
    return out;
  }

  function toMatchPair(card) {
    return { card: card, wrongAttempts: 0, matched: false };
  }

  function startMatchSession() {
    matchBoards.front = drawMatchCards(MATCH_BATCH_SIZE).map(toMatchPair);
    matchBoards.back = [];
    matchSelected = null;

    var cardEl = document.getElementById("card");
    cardEl.classList.remove("flipped", "swipe-pass", "swipe-fail", "answer-correct", "answer-incorrect");
    cardEl.style.transition = "";
    cardEl.style.transform = "";
    cardEl.style.opacity = "";

    if (matchBoards.front.length === 0) {
      finishStudy();
      return;
    }

    renderMatchFace("front", matchBoards.front);
    clearMatchFace("back");

    var tapHintEl = document.getElementById("tap-hint");
    tapHintEl.classList.remove("hidden");
    tapHintEl.textContent = "Tap the words to match them.";

    document.getElementById("study-answer-controls").classList.add("hidden");
    document.getElementById("type-answer-bar").classList.add("hidden");

    updateMatchProgress();
  }

  function clearMatchFace(face) {
    document.getElementById("match-col-es-" + face).innerHTML = "";
    document.getElementById("match-col-tr-" + face).innerHTML = "";
  }

  function renderMatchFace(face, pairs) {
    var leftCol = document.getElementById("match-col-es-" + face);
    var rightCol = document.getElementById("match-col-tr-" + face);
    leftCol.innerHTML = "";
    rightCol.innerHTML = "";

    pairs.forEach(function (pair) {
      var leftItem = document.createElement("button");
      leftItem.type = "button";
      leftItem.className = "match-item";
      leftItem.textContent = pair.card.word;
      leftItem.addEventListener("click", function () { onMatchTap(face, pair, leftItem, "left"); });
      leftCol.appendChild(leftItem);
    });

    shuffle(pairs.slice()).forEach(function (pair) {
      var rightItem = document.createElement("button");
      rightItem.type = "button";
      rightItem.className = "match-item";
      rightItem.textContent = pair.card.translation;
      rightItem.addEventListener("click", function () { onMatchTap(face, pair, rightItem, "right"); });
      rightCol.appendChild(rightItem);
    });
  }

  function onMatchTap(face, pair, el, side) {
    var cardEl = document.getElementById("card");
    var isBack = cardEl.classList.contains("flipped");
    if ((face === "back") !== isBack) return;
    if (pair.matched) return;
    if (matchSelected && matchSelected.busy) return;

    if (side === "left") {
      if (matchSelected && matchSelected.el) matchSelected.el.classList.remove("selected");
      matchSelected = { pair: pair, el: el, face: face };
      el.classList.add("selected");
      return;
    }

    if (!matchSelected || matchSelected.face !== face) return;
    var leftPair = matchSelected.pair;
    var leftEl = matchSelected.el;

    if (leftPair === pair) {
      leftEl.classList.remove("selected");
      leftEl.classList.add("correct");
      el.classList.add("correct");
      pair.matched = true;
      matchSelected = null;
      // Left in the flex layout (not display:none) so its slot stays
      // reserved as empty space instead of the remaining tiles growing to
      // fill the gap.
      setTimeout(function () {
        leftEl.classList.add("vanish");
        el.classList.add("vanish");
      }, MATCH_FLASH_MS);
      if (matchBoards[face].every(function (p) { return p.matched; })) {
        setTimeout(function () { advanceMatchBatch(face); }, MATCH_FLASH_MS + MATCH_VANISH_MS + 50);
      }
    } else {
      matchSelected.busy = true;
      leftPair.wrongAttempts++;
      leftEl.classList.add("wrong");
      el.classList.add("wrong");
      setTimeout(function () {
        leftEl.classList.remove("selected", "wrong");
        el.classList.remove("wrong");
        matchSelected = null;
      }, 450);
    }
  }

  function advanceMatchBatch(face) {
    matchBoards[face].forEach(function (pair) {
      resolveStudyCard(pair.card, pair.wrongAttempts === 0);
    });
    saveData();

    var otherFace = face === "front" ? "back" : "front";
    var nextCards = drawMatchCards(MATCH_BATCH_SIZE);
    if (nextCards.length === 0) {
      finishStudy();
      return;
    }
    matchBoards[otherFace] = nextCards.map(toMatchPair);
    renderMatchFace(otherFace, matchBoards[otherFace]);
    document.getElementById("card").classList.toggle("flipped", face === "front");
    updateMatchProgress();
  }

  function updateMatchProgress() {
    var pendingBoards = matchBoards.front.filter(function (p) { return !p.matched; }).length +
      matchBoards.back.filter(function (p) { return !p.matched; }).length;
    var remaining = session.queue.length + session.reviewQueue.length + pendingBoards;
    document.getElementById("study-progress").textContent =
      session.passed + " done · " + remaining + " left";
    var total = session.passed + remaining;
    var pct = total > 0 ? (session.passed / total * 100) : 0;
    document.getElementById("study-progress-fill").style.width = pct + "%";
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
      "#notes:" + encodeURIComponent(JSON.stringify(notesList))
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
    var importedNotes = null;

    text.split(/\r?\n/).forEach(function (line) {
      if (!line) return;
      if (line.charAt(0) === "#") {
        if (line.indexOf("#notes:") === 0) {
          try {
            var decodedNotes = JSON.parse(decodeURIComponent(line.slice("#notes:".length)));
            importedNotes = normalizeNotesList(decodedNotes, null);
          } catch (e) {}
        } else if (line.indexOf("#notepad:") === 0) {
          // Pre-multi-note export format - a single freeform string.
          try {
            var decodedNotepad = decodeURIComponent(line.slice("#notepad:".length));
            importedNotes = normalizeNotesList(null, decodedNotepad);
          } catch (e) {}
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

    return { items: items, notes: importedNotes };
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
    return { items: items };
  }

  // Adds parsed cards (Import or Ask Gemini), matching by word + translation
  // case-insensitively: a duplicate isn't re-added, but its deck tags are
  // merged in. Missing decks are created. Returns how many cards were new.
  function mergeIncomingCards(incoming) {
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
    return added;
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

        // Only adopt imported notes when there are none written locally
        // yet, so it can't clobber
        // notes already in progress on this device.
        if (parsed.notes && parsed.notes.length && !notesList.length) {
          notesList = parsed.notes;
        }

        var added = mergeIncomingCards(incoming);
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
  //
  // With viewport-fit=cover, an iOS Home Screen app can also report an
  // innerHeight that's short by the status bar's height (the page is drawn
  // under the status bar, but sized as if it weren't), which left a blank
  // band at the bottom of every screen and lifted the tab bar. The status
  // bar's inset is added back in that case - never past the real screen.
  var appHeightFrozen = false;
  var safeTopProbe = null;
  function safeAreaTop() {
    if (!safeTopProbe) {
      safeTopProbe = document.createElement("div");
      safeTopProbe.style.cssText = "position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top, 0px);visibility:hidden;pointer-events:none";
      document.body.appendChild(safeTopProbe);
    }
    return safeTopProbe.offsetHeight;
  }
  function setAppHeight() {
    if (appHeightFrozen) return;
    var height = window.innerHeight;
    if (isStandaloneMode()) {
      height = Math.min(height + safeAreaTop(), Math.max(window.screen.height, height));
    }
    document.documentElement.style.setProperty("--app-height", height + "px");
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

  // ---------- google drive backup (see drive.js) ----------
  var drive = window.FlashcardsDrive;

  drive.init({
    // Everything a new phone needs - not lastExportAt, which is about this
    // device's own file exports.
    exportData: function () {
      return {
        cards: cards,
        sections: sections,
        notes: notesList,
        foreignLanguage: foreignLanguage,
        lastStudyPrefs: lastStudyPrefs
      };
    },
    // Replaces everything here with the Drive copy, run through loadData()
    // so a backup gets the same repairs/migrations as local storage does.
    importData: function (data) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        cards: Array.isArray(data.cards) ? data.cards : [],
        sections: Array.isArray(data.sections) ? data.sections : [],
        lastExportAt: lastExportAt,
        lastStudyPrefs: data.lastStudyPrefs || null,
        notes: Array.isArray(data.notes) ? data.notes : [],
        foreignLanguage: typeof data.foreignLanguage === "string" ? data.foreignLanguage : DEFAULT_LANGUAGE_CODE
      }));
      var restored = loadData();
      cards = restored.cards;
      sections = restored.sections;
      notesList = restored.notes;
      foreignLanguage = restored.foreignLanguage;
      lastStudyPrefs = restored.lastStudyPrefs;
      saveData();
      applyLanguage();
      lastDailyCardId = null;
      refreshHome();
    }
  });

  var DRIVE_ERRORS = {
    signin: "Google sign-in was cancelled or failed.",
    expired: "The Google connection expired - tap “Back up now” to reconnect.",
    network: "No connection to Google Drive.",
    quota: "Your Google Drive is full.",
    missing: "There's no Flashcards backup in this Google Drive yet.",
    apiDisabled: "The Google Drive API isn't turned on for this app's Google Cloud project. In console.cloud.google.com open the same project → APIs & Services → Library → Google Drive API → Enable, wait a minute, then tap “Back up now”.",
    scope: "Google Drive access wasn't allowed during sign-in. Tap “Sign in again” and tick the Google Drive box on Google's permission screen.",
    failed: "Google Drive returned an error. Try again."
  };

  function driveWhen(ms) {
    return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }

  // Google profile picture, or the account's initial when there's none (or no network).
  function fillAvatar(el, st) {
    el.innerHTML = "";
    var initial = document.createElement("span");
    initial.textContent = (st.name || st.email || "?").trim().charAt(0).toUpperCase();
    if (st.picture) {
      var img = document.createElement("img");
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.src = st.picture;
      img.onerror = function () { el.innerHTML = ""; el.appendChild(initial); };
      el.appendChild(img);
    } else {
      el.appendChild(initial);
    }
  }

  var lastAvatarKey = null;

  function renderDrive() {
    var st = drive.state();
    document.getElementById("btn-drive").classList.toggle("hidden", !st.enabled);
    if (!st.enabled) return;

    var avatarBtn = document.getElementById("btn-drive-avatar");
    avatarBtn.classList.toggle("hidden", !st.signedIn);
    var avatarKey = st.signedIn ? (st.picture || "") + "|" + st.email : null;
    if (avatarKey !== lastAvatarKey) {
      lastAvatarKey = avatarKey;
      if (st.signedIn) {
        fillAvatar(avatarBtn, st);
        fillAvatar(document.getElementById("drive-account-avatar"), st);
      }
    }

    document.getElementById("drive-menu-hint").textContent = !st.signedIn
      ? "Keep your cards safe in Google Drive"
      : st.lastBackup ? "Last backup: " + driveWhen(st.lastBackup) : "Signed in as " + st.email;

    // Changes are waiting and the Google connection has lapsed.
    document.getElementById("drive-banner").classList.toggle("hidden",
      !(st.signedIn && st.linked && st.unsaved && !st.connected && !st.busy));

    document.getElementById("drive-signed-out").classList.toggle("hidden", st.signedIn);
    document.getElementById("drive-signed-in").classList.toggle("hidden", !st.signedIn);
    document.getElementById("drive-auto-note").classList.toggle("hidden", !st.signedIn);
    if (!st.signedIn) return;

    document.getElementById("drive-account-email").textContent = "Signed in as " + st.email;

    var status = document.getElementById("drive-status");
    status.classList.toggle("hidden", !!st.choose);
    status.textContent = st.busy === "backup" ? "Backing up…"
      : st.busy === "restore" ? "Restoring…"
      : (st.lastBackup ? "Last backup: " + driveWhen(st.lastBackup) + "." : "Not backed up yet.") +
        (st.unsaved && st.lastBackup ? " Some changes aren't backed up yet." : "");

    document.getElementById("drive-choose").classList.toggle("hidden", !st.choose);
    if (st.choose) {
      document.getElementById("drive-choose-text").textContent =
        "Your Google Drive already has a backup from " + driveWhen(st.choose.remoteTime) +
        ". Restore it to this phone, or replace it with what's on this phone?";
    }

    document.getElementById("drive-error").classList.toggle("hidden", !st.error);
    document.getElementById("drive-error-text").textContent = st.error ? DRIVE_ERRORS[st.error] : "";
    var detail = document.getElementById("drive-error-detail");
    detail.classList.toggle("hidden", !st.errorDetail);
    detail.textContent = st.errorDetail ? "Details: " + st.errorDetail : "";
    document.getElementById("btn-drive-signin-again").classList.toggle("hidden", st.error !== "scope");

    document.getElementById("drive-actions").classList.toggle("hidden", !!st.choose);
    document.getElementById("btn-drive-backup").disabled = !!st.busy;
    document.getElementById("btn-drive-restore").disabled = !!st.busy;
  }

  drive.subscribe(renderDrive);

  // Settings or the home avatar - back returns there.
  var driveReturnTo = "home";

  function openDriveView(from) {
    driveReturnTo = from;
    renderDrive();
    showView("drive");
  }

  document.getElementById("btn-drive").addEventListener("click", function () { openDriveView("settings"); });
  document.getElementById("btn-drive-avatar").addEventListener("click", function () { openDriveView("home"); });
  document.getElementById("btn-drive-back").addEventListener("click", function () {
    if (driveReturnTo === "settings") {
      showView("settings");
      return;
    }
    refreshHome();
    showView("home");
  });
  document.getElementById("btn-drive-signin").addEventListener("click", function () { drive.signIn("connect"); });
  document.getElementById("btn-drive-signin-again").addEventListener("click", function () { drive.signIn("connect", true); });
  document.getElementById("btn-drive-backup").addEventListener("click", function () { drive.backupNow(); });
  document.getElementById("btn-drive-banner-action").addEventListener("click", function () { drive.backupNow(); });
  document.getElementById("btn-drive-restore").addEventListener("click", function () {
    if (confirm("Replace everything on this phone with the Google Drive backup?")) drive.restoreFromDrive();
  });
  document.getElementById("btn-drive-use-drive").addEventListener("click", function () { drive.restoreFromDrive(); });
  document.getElementById("btn-drive-use-phone").addEventListener("click", function () {
    if (confirm("Overwrite the Google Drive backup with this phone's data?")) drive.backupNow(true);
  });
  document.getElementById("btn-drive-signout").addEventListener("click", function () {
    if (confirm("Sign out of Google? Your cards stay on this phone.")) drive.signOut();
  });

  // ---------- backup reminder ----------
  function maybePromptBackup() {
    if (cards.length === 0) return;
    // Google Drive already keeps a copy - no need to nag about file exports.
    if (drive.state().linked) return;
    var weekMs = 7 * 86400000;
    if (lastExportAt && Date.now() - lastExportAt < weekMs) return;
    var msg = lastExportAt
      ? "It's been a week since your last backup. Export your cards and progress now?"
      : "You haven't backed up your cards yet. Export now?";
    if (confirm(msg)) performExport();
  }

  // ---------- init ----------
  applyLanguage();
  refreshHome();
  drive.handleRedirect();
  renderDrive();
  // Back from Google's sign-in page: land where the outcome is shown.
  if (drive.cameBackFromSignIn()) {
    showView("drive");
    return;
  }
  showView("home");
  // confirm() blocks the main thread and can fire before the browser has
  // painted anything - a short delay lets the home screen actually render
  // first instead of a black screen holding until the dialog is dismissed.
  setTimeout(maybePromptBackup, 400);
})();
