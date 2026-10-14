// ---------- Google Drive backup ----------
// Automatic backup to Google Drive without a server - the same approach as
// Coffee Shelf. Sign-in is Google's OAuth flow for browser apps
// (response_type=token) done as a full-page redirect rather than a popup,
// because popups are unreliable in iOS home-screen apps. The app asks only
// for drive.appdata: a hidden per-app folder, so it can't see the user's
// other files. Browser tokens last about an hour and can't be refreshed
// silently, so backups run on their own while connected and otherwise wait
// for one tap ("Back up now").
//
// app.js plugs in through FlashcardsDrive.init({ exportData, importData }) and
// calls markChanged() whenever it saves.
window.FlashcardsDrive = (function () {
  "use strict";

  // OAuth "Web application" client (shared with Coffee Shelf - both live on
  // mindjah.github.io). Its Authorized redirect URIs must include this app's
  // URL, e.g. https://mindjah.github.io/flashcards/. Empty hides the feature.
  var CLIENT_ID = "1070550439815-0eguk16pr72tp96ta120t7ipdk284afh.apps.googleusercontent.com";
  // "profile" only adds the name and picture shown as the avatar.
  var SCOPES = "openid email profile https://www.googleapis.com/auth/drive.appdata";
  var FILE_NAME = "flashcards-backup.json";
  var KEY = "flashcards.drive";
  var AUTO_BACKUP_DELAY_MS = 4000;

  // Persisted: email, name, picture, token, expiresAt, lastBackup (last
  // successful upload from this device), remoteTime (Drive file's modified
  // time when last seen), lastChange (last local save), pending (sign-in
  // round trip in progress), and linked - this device has backed up or
  // restored at least once. Until then automatic backup stays off, so a
  // fresh phone can't overwrite an existing Drive backup with no cards.
  var stored = load();
  var busy = null;
  var error = null;
  var errorDetail = null;
  // Drive has a backup but this device hasn't chosen between restoring and replacing it.
  var choose = null;
  var cameBack = false;
  var hooks = { exportData: null, importData: null };
  var listeners = [];

  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function update(patch) {
    if (patch) Object.keys(patch).forEach(function (k) { stored[k] = patch[k]; });
    try {
      localStorage.setItem(KEY, JSON.stringify(stored));
    } catch (e) {
      // Kept for this session only.
    }
    listeners.forEach(function (l) { l(); });
  }

  function state() {
    return {
      enabled: !!CLIENT_ID,
      signedIn: !!stored.email,
      email: stored.email,
      name: stored.name,
      picture: stored.picture,
      // A usable access token right now.
      connected: !!stored.token && (stored.expiresAt || 0) > Date.now() + 60000,
      linked: !!stored.linked,
      lastBackup: stored.lastBackup,
      busy: busy,
      error: error,
      errorDetail: errorDetail,
      choose: choose,
      // Cards changed since the last backup from this device.
      unsaved: !!stored.email && (stored.lastChange || 0) > (stored.lastBackup || 0)
    };
  }

  function subscribe(listener) {
    listeners.push(listener);
  }

  // ---------- sign-in ----------

  function redirectUri() {
    // The folder URL (".../flashcards/"), whether the app was opened as that
    // or as ".../index.html" - Google needs one exact registered value.
    return new URL("./", location.href).href;
  }

  // Leaves the app for Google's sign-in page; handleRedirect() finishes on return.
  // forceConsent shows Google's permission screen again, e.g. after the Drive box was left unticked.
  function signIn(intent, forceConsent) {
    var stateToken = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
    update({ pending: { state: stateToken, intent: intent || "connect" } });
    var params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: redirectUri(),
      response_type: "token",
      scope: SCOPES,
      state: stateToken,
      include_granted_scopes: "true"
    });
    // A known account comes straight back without the account picker.
    if (forceConsent) params.set("prompt", "consent");
    else if (!stored.email) params.set("prompt", "select_account");
    if (stored.email) params.set("login_hint", stored.email);
    location.assign("https://accounts.google.com/o/oauth2/v2/auth?" + params);
  }

  function signOut() {
    var token = stored.token;
    stored = {};
    error = null;
    errorDetail = null;
    choose = null;
    update();
    if (token) {
      fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(token), { method: "POST" }).catch(function () {});
    }
  }

  // True when this launch is the return from Google's sign-in page.
  function cameBackFromSignIn() {
    return cameBack;
  }

  // Call once at startup: picks up the token Google puts in the URL fragment after sign-in.
  function handleRedirect() {
    if (location.hash.indexOf("access_token=") === -1 && location.hash.indexOf("error=") === -1) {
      return Promise.resolve();
    }
    cameBack = true;
    var params = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, "", location.pathname + location.search);
    var pending = stored.pending;
    if (!pending || params.get("state") !== pending.state) {
      update({ pending: undefined });
      return Promise.resolve();
    }
    if (params.get("error") || !params.get("access_token")) {
      error = "signin";
      update({ pending: undefined });
      return Promise.resolve();
    }
    update({
      token: params.get("access_token"),
      expiresAt: Date.now() + Number(params.get("expires_in") || 3600) * 1000,
      pending: undefined
    });
    return api("https://www.googleapis.com/oauth2/v3/userinfo")
      .then(function (res) { return res.json(); })
      .then(function (me) { update({ email: me.email, name: me.name, picture: me.picture }); })
      // The email is only for display; carry on without it.
      .catch(function () { if (!stored.email) update({ email: "Google account" }); })
      .then(function () {
        // Google's permission screen has a checkbox per permission; without Drive there's nothing to do.
        var granted = params.get("scope") || "";
        if (granted && granted.indexOf("drive.appdata") === -1) {
          error = "scope";
          errorDetail = "scope: " + granted;
          update();
          return;
        }
        return pending.intent === "restore" ? restoreFromDrive() : afterConnect();
      });
  }

  // ---------- Drive ----------

  function DriveHttpError(status, body) {
    this.status = status;
    this.body = body || "";
    this.message = "Drive " + status;
  }

  function checked(res) {
    if (res.ok) return res;
    return res.text().catch(function () { return ""; }).then(function (body) {
      throw new DriveHttpError(res.status, body);
    });
  }

  function api(url, init) {
    init = init || {};
    var headers = Object.assign({}, init.headers, { Authorization: "Bearer " + stored.token });
    return fetch(url, Object.assign({}, init, { headers: headers })).then(checked);
  }

  function findFile() {
    var q = encodeURIComponent("name='" + FILE_NAME + "'");
    return api("https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=" + q +
      "&fields=files(id,modifiedTime)&orderBy=modifiedTime desc")
      .then(function (res) { return res.json(); })
      .then(function (json) { return (json.files || [])[0]; });
  }

  // Resumable upload, so a big collection isn't limited by the 5 MB simple-upload cap.
  function upload(body, fileId) {
    var meta = fileId ? {} : { name: FILE_NAME, parents: ["appDataFolder"] };
    return api(
      "https://www.googleapis.com/upload/drive/v3/files" + (fileId ? "/" + fileId : "") + "?uploadType=resumable&fields=modifiedTime",
      {
        method: fileId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "application/json" },
        body: JSON.stringify(meta)
      }
    ).then(function (start) {
      var session = start.headers.get("Location");
      if (!session) throw new DriveHttpError(500);
      return fetch(session, { method: "PUT", headers: { "Content-Type": "application/json" }, body: body });
    }).then(checked).then(function (res) { return res.json(); });
  }

  // Google's machine-readable reason from an error body, e.g. "SERVICE_DISABLED".
  function reasonOf(body) {
    try {
      var err = JSON.parse(body).error || {};
      var detail = (err.details || []).filter(function (d) { return d.reason; })[0];
      return (detail && detail.reason) || (err.errors && err.errors[0] && err.errors[0].reason) || err.status || "";
    } catch (e) {
      return String(body).slice(0, 80);
    }
  }

  function fail(e) {
    if (e instanceof DriveHttpError) {
      var reason = reasonOf(e.body);
      errorDetail = (e.status + " " + reason).trim();
      if (e.status === 401) {
        error = "expired";
        update({ token: undefined, expiresAt: undefined });
        return;
      }
      error = /SERVICE_DISABLED|accessNotConfigured/.test(reason) ? "apiDisabled"
        : /SCOPE_INSUFFICIENT|insufficientPermissions|insufficientScopes/.test(reason) ? "scope"
        : /storageQuotaExceeded|quotaExceeded/.test(reason) ? "quota"
        : e.status === 404 ? "missing"
        : "failed";
    } else {
      error = "network";
      errorDetail = e && e.message;
    }
    update();
  }

  function run(kind, work) {
    if (busy) return Promise.resolve();
    busy = kind;
    error = null;
    errorDetail = null;
    update();
    return Promise.resolve()
      .then(work)
      .catch(function (e) { fail(e); })
      .then(function (result) {
        busy = null;
        update();
        return result;
      });
  }

  // First connection on this device: never let an empty phone silently replace a Drive backup.
  function afterConnect() {
    if (stored.linked) return backupNow();
    return run("backup", findFile).then(function (file) {
      if (file) {
        choose = { remoteTime: Date.parse(file.modifiedTime) };
        update({ remoteTime: choose.remoteTime });
      } else if (!error) {
        return backupNow(true);
      }
    });
  }

  // Uploads everything. force also replaces a Drive backup this device hasn't linked to yet.
  function backupNow(force) {
    if (!state().connected) return signIn("backup");
    if (!stored.linked && !force) return afterConnect();
    return run("backup", function () {
      var startedAt = Date.now();
      var body = JSON.stringify({ app: "flashcards", format: 1, savedAt: startedAt, data: hooks.exportData() });
      return findFile().then(function (file) {
        return upload(body, file && file.id);
      }).then(function (res) {
        choose = null;
        update({ lastBackup: startedAt, remoteTime: Date.parse(res.modifiedTime), linked: true });
      });
    });
  }

  function restoreFromDrive() {
    if (!state().connected) return signIn("restore");
    return run("restore", function () {
      var file;
      return findFile().then(function (f) {
        file = f;
        if (!file) throw new DriveHttpError(404);
        return api("https://www.googleapis.com/drive/v3/files/" + file.id + "?alt=media");
      }).then(function (res) {
        return res.json();
      }).then(function (backup) {
        if (!backup || !backup.data) throw new Error("Not a Flashcards backup");
        hooks.importData(backup.data);
        choose = null;
        // Local data now equals the Drive copy, so nothing is waiting to be backed up.
        update({ lastBackup: Date.now(), remoteTime: Date.parse(file.modifiedTime), linked: true });
      });
    });
  }

  // ---------- automatic backup ----------

  var timer = null;

  // Backs up a few seconds after a change, whenever a token is still valid.
  function markChanged() {
    stored.lastChange = Date.now();
    update();
    clearTimeout(timer);
    timer = setTimeout(function () {
      var s = state();
      if (s.connected && s.linked && s.unsaved) backupNow();
    }, AUTO_BACKUP_DELAY_MS);
  }

  function init(options) {
    hooks.exportData = options.exportData;
    hooks.importData = options.importData;
    // Expiry isn't an event; re-check now and then so "connected" stays truthful.
    setInterval(function () { update(); }, 60000);
  }

  return {
    init: init,
    state: state,
    subscribe: subscribe,
    signIn: signIn,
    signOut: signOut,
    handleRedirect: handleRedirect,
    cameBackFromSignIn: cameBackFromSignIn,
    backupNow: backupNow,
    restoreFromDrive: restoreFromDrive,
    markChanged: markChanged
  };
})();
