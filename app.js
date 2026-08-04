(function () {
  "use strict";

  var STORAGE_KEY = "esCards";
  var BOX_INTERVALS_DAYS = [0, 1, 3, 7, 16, 35]; // index = box number, box0 = due immediately
  var MAX_BOX = BOX_INTERVALS_DAYS.length - 1;

  // ---------- storage ----------
  function loadCards() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error("Failed to load cards", e);
      return [];
    }
  }

  function saveCards(cards) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
  }

  var cards = loadCards();

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function isDue(card, now) {
    return card.dueAt <= now;
  }

  function dueCards() {
    var now = Date.now();
    return cards.filter(function (c) { return isDue(c, now); });
  }

  // ---------- view management ----------
  var views = {
    home: document.getElementById("view-home"),
    study: document.getElementById("view-study"),
    empty: document.getElementById("view-empty"),
    add: document.getElementById("view-add"),
    manage: document.getElementById("view-manage")
  };

  function showView(name) {
    Object.keys(views).forEach(function (k) {
      views[k].classList.toggle("hidden", k !== name);
    });
  }

  // ---------- home ----------
  function refreshHome() {
    document.getElementById("stat-due").textContent = dueCards().length;
    document.getElementById("stat-total").textContent = cards.length;
  }

  document.getElementById("btn-add").addEventListener("click", function () {
    openAddView(null);
  });

  document.getElementById("btn-manage").addEventListener("click", function () {
    renderManageList();
    showView("manage");
  });

  // ---------- add / edit card ----------
  var editingId = null;

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
    } else {
      editingId = null;
      titleEl.textContent = "Add card";
      saveBtn.textContent = "Save card";
      wordEl.value = "";
      transEl.value = "";
      notesEl.value = "";
    }

    document.getElementById("save-toast").classList.add("hidden");
    showView("add");
    wordEl.focus();
  }

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
        saveCards(cards);
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
      box: 0,
      dueAt: Date.now(),
      createdAt: Date.now()
    });
    saveCards(cards);

    wordEl.value = "";
    transEl.value = "";
    notesEl.value = "";
    wordEl.focus();

    var toast = document.getElementById("save-toast");
    toast.classList.remove("hidden");
    setTimeout(function () { toast.classList.add("hidden"); }, 1200);
  });

  // ---------- manage ----------
  function renderManageList(filter) {
    var list = document.getElementById("manage-list");
    list.innerHTML = "";

    var items = cards.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    if (filter) {
      var f = filter.toLowerCase();
      items = items.filter(function (c) {
        return c.word.toLowerCase().indexOf(f) !== -1 ||
               c.translation.toLowerCase().indexOf(f) !== -1;
      });
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

      var meta = document.createElement("div");
      meta.className = "manage-item-meta";
      var now = Date.now();
      meta.textContent = isDue(c, now) ? "Due now" : "Due " + formatRelative(c.dueAt - now);
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
        saveCards(cards);
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

  document.getElementById("btn-manage-back").addEventListener("click", function () {
    refreshHome();
    showView("home");
  });

  // ---------- study session ----------
  var session = { queue: [], current: null, revealed: false, studied: 0, passed: 0, failed: 0, allMode: false };

  function startStudy(allMode) {
    var source = allMode ? cards.slice() : dueCards();
    if (source.length === 0) {
      showEmpty(cards.length === 0 ? "no-cards" : "no-due");
      return;
    }
    session.queue = shuffle(source.slice());
    session.studied = 0;
    session.passed = 0;
    session.failed = 0;
    session.allMode = !!allMode;
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
    document.getElementById("card-word").textContent = session.current.word;
    document.getElementById("card-translation").textContent = session.current.translation;
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
    saveCards(cards);
    nextCard();
  }

  function finishStudy() {
    var text = "Studied " + session.studied + " card" + (session.studied === 1 ? "" : "s") +
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
      msg.textContent = "No cards yet. Add some to start studying!";
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

  document.getElementById("btn-study").addEventListener("click", function () {
    startStudy(false);
  });

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

  // ---------- import / export ----------
  document.getElementById("btn-export").addEventListener("click", function () {
    var data = JSON.stringify({ version: 1, exportedAt: Date.now(), cards: cards }, null, 2);
    var blob = new Blob([data], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    var date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = "spanish-cards-" + date + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });

  document.getElementById("btn-import").addEventListener("click", function () {
    document.getElementById("file-import").click();
  });

  document.getElementById("file-import").addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        var incoming = Array.isArray(data) ? data : data.cards;
        if (!Array.isArray(incoming)) throw new Error("Invalid file format");

        var existingWords = new Set(cards.map(function (c) { return c.word.toLowerCase() + "|" + c.translation.toLowerCase(); }));
        var added = 0;
        incoming.forEach(function (item) {
          if (!item || !item.word || !item.translation) return;
          var key = String(item.word).toLowerCase() + "|" + String(item.translation).toLowerCase();
          if (existingWords.has(key)) return;
          existingWords.add(key);
          cards.push({
            id: uid(),
            word: String(item.word),
            translation: String(item.translation),
            notes: item.notes ? String(item.notes) : "",
            box: typeof item.box === "number" ? Math.min(Math.max(item.box, 0), MAX_BOX) : 0,
            dueAt: typeof item.dueAt === "number" ? item.dueAt : Date.now(),
            createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now()
          });
          added++;
        });
        saveCards(cards);
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

  // ---------- service worker ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("service-worker.js").catch(function () {});
    });
  }

  // ---------- init ----------
  refreshHome();
  showView("home");
})();
