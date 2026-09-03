let me = null; // { account, profile }
let META = { guessAxes: [] };
const selectedMH = new Set();

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let photoData = null; // uploaded photo as a downscaled data: URL
let idData = null; // ID-next-to-face photo, only when a reviewer asked for one
let onboardRole = null; // "voter" | "participant" — which path they picked
let versusKeys = null; // set to a pick(side) fn while a comparison round is active
document.addEventListener("keydown", (e) => {
  if (!versusKeys) return;
  if (e.key === "ArrowLeft") versusKeys("a");
  else if (e.key === "ArrowRight") versusKeys("b");
});
const api = (url, opts) => fetch(url, opts).then(async (r) => ({ status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }));
const post = (url, body) => api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function avatar(u, cls = "") {
  // photoUrl is a short-lived, viewer-bound link minted by the server — the
  // client never sees image bytes or a stable photo id.
  return u.photoUrl
    ? `<img class="${cls}" src="${esc(u.photoUrl)}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'avatar ${cls}'}))" />`
    : `<div class="avatar ${cls}"></div>`;
}
const setCredits = (n) => { if (n != null) $("#credits").textContent = n; };

// ================= Auth screen =================
let authMode = "login";
$("#tab-login").addEventListener("click", () => setAuthMode("login"));
$("#tab-signup").addEventListener("click", () => setAuthMode("signup"));
function setAuthMode(mode) {
  authMode = mode;
  // Signing up is the act of accepting the terms, so the box and the state
  // question only appear on that path.
  $("#legal-consent").hidden = mode !== "signup";
  $("#state-wrap").hidden = !(mode === "signup" && AUTH_CFG.country === "US");
  $("#tab-login").classList.toggle("active", mode === "login");
  $("#tab-signup").classList.toggle("active", mode === "signup");
  $("#auth-submit").textContent = mode === "login" ? "Log in" : "Create account";
  $("#auth-form").password.autocomplete = mode === "login" ? "current-password" : "new-password";
  $("#auth-err").hidden = true;
}
$("#auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = e.target.email.value, password = e.target.password.value;
  if (authMode === "signup" && !$("#legal-agree").checked) {
    $("#auth-err").textContent = "You need to confirm you're 18+ and agree to the Terms.";
    $("#auth-err").hidden = false;
    return;
  }
  const state = e.target.state?.value || undefined;
  const { status, body } = await post(`/auth/${authMode}`, { email, password, state });
  if (status >= 400) {
    $("#auth-err").textContent = body?.error || "Something went wrong.";
    $("#auth-err").hidden = false;
    return;
  }
  await boot();
});

// ================= Navigation =================
document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));
function show(view) {
  versusKeys = null; // leaving any comparison round
  document.querySelectorAll("#app .view").forEach((v) => v.classList.remove("active"));
  $("#view-" + view)?.classList.add("active");
  document.querySelectorAll("nav.tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  if (view === "home") loadHome();
  // Without this the bottom-nav "Rate" tab shows an empty screen: the matchup
  // was only ever loaded by the home face-cards, which call it directly.
  if (view === "matchup") loadMatchup();
  if (view === "report") loadReport();
  if (view === "buy") loadBuy();
  if (view === "admin") loadAdminQueue();
  if (view === "moral") loadMoralQuiz();
  if (view === "boards") loadBoards();
  window.scrollTo(0, 0);
}

$("#signout").addEventListener("click", async () => {
  await post("/auth/logout", {});
  location.reload();
});

// ================= Bootstrap =================
let AUTH_CFG = {};
(async function start() {
  const cfg = await api("/auth/config");
  AUTH_CFG = cfg.body || {};
  if (AUTH_CFG.google) $("#google-wrap").hidden = false;
  const sel = $("#auth-form").state;
  if (sel && AUTH_CFG.usStates) {
    const blocked = new Set(AUTH_CFG.blockedStates || []);
    sel.innerHTML = `<option value="">select…</option>` +
      AUTH_CFG.usStates.map(([code, label]) =>
        `<option value="${code}">${esc(label)}${blocked.has(code) ? " (not available)" : ""}</option>`).join("");
  }
  initPhotoFlow();
  await buildForms();
  await boot();
})();

// ---- Add-your-photo flow wiring ----
function downscaleImage(file, max = 420) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.72));
    };
    img.onerror = reject;
    img.src = url;
  });
}
function initPhotoFlow() {
  $("#choose-photo").addEventListener("click", () => $("#photo-file").click());
  $("#photo-file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      photoData = await downscaleImage(f);
      $("#photo-preview").hidden = false;
      $("#photo-preview").innerHTML = `<img src="${photoData}" alt="preview" />`;
      $("#choose-photo").textContent = "change photo";
    } catch { alert("Couldn't read that image — try another."); }
  });
  $("#photo-url-toggle").addEventListener("click", () => { $("#photo-url").hidden = !$("#photo-url").hidden; });

  // The ID photo, shown only when a reviewer has asked for one. Kept larger
  // than a profile photo so the writing on the document stays readable.
  $("#choose-id").addEventListener("click", () => $("#id-file").click());
  $("#id-file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      idData = await downscaleImage(f, 1400);
      $("#id-preview").hidden = false;
      $("#id-preview").innerHTML = `<img src="${idData}" alt="ID preview" />`;
      $("#choose-id").textContent = "change ID photo";
    } catch { alert("Couldn't read that image — try another."); }
  });

  // The voter / participant fork.
  $("#role-fork").querySelectorAll("[data-role]").forEach((btn) =>
    btn.addEventListener("click", () => setOnboardRole(btn.dataset.role)));
  $("#prediction").addEventListener("input", (e) => {
    const r = $("#pred-readout");
    r.textContent = `you predict ${e.target.value}%`;
    r.classList.add("set");
  });
  const confirms = $$("#confirms [data-confirm]");
  const gate = () => { $("#submit-face").disabled = !confirms.every((c) => c.checked); };
  confirms.forEach((c) => c.addEventListener("change", gate));
}

async function boot() {
  const { status, body } = await api("/api/me");
  if (status === 401) return showLanding();
  me = body;
  // A new terms version blocks everything until it's accepted.
  if (me.outstanding?.length) {
    const ok = await settleOutstanding(me.outstanding);
    if (!ok) return showLanding();
  }
  $("#view-landing").classList.remove("active");
  $("#app").hidden = false;
  setCredits(me.profile?.credits ?? 0);
  $("#tab-admin").hidden = !me.isAdmin;
  $("#admin-tile").hidden = !me.isAdmin;
  renderPhotoStatus();
  renderMoralNag();
  if (!me.profile) {
    showApp();
    show("onboard");
    prefillName();
    $("#role-fork").hidden = false;
    setOnboardRole("participant"); // pre-selected, but the choice is visible
  } else {
    showApp();
    show("home");
  }
}
function showLanding() { $("#app").hidden = true; $("#view-landing").classList.add("active"); }
function showApp() { $("#view-landing").classList.remove("active"); $("#app").hidden = false; }
// Voters get a profile and nothing else — no photo, no ID, no 18+ gate. They
// still need an account, because a signed-in vote is what makes duplicate
// accounts and vote-stuffing detectable.
function setOnboardRole(role) {
  onboardRole = role;
  const participant = role === "participant";
  $("#role-fork").querySelectorAll("[data-role]").forEach((b) =>
    b.classList.toggle("sel", b.dataset.role === role));
  // Everything below the fork is participant-only.
  for (const sel of ["#photo-card", "#socials-card", "#confirms-card", "#pred-card", "#ratings-from-card", "#reqs-card"]) {
    const el = document.querySelector(sel);
    if (el) el.hidden = !participant;
  }
  $("#submit-face").textContent = participant ? "submit my face" : "start voting";
  $("#submit-face").disabled = participant
    ? ![...$$("#confirms [data-confirm]")].every((c) => c.checked)
    : false;
}

function prefillName() {
  const f = $("#onboard-form");
  const email = me.account?.email || "";
  if (!f.name.value) f.name.value = email.split("@")[0] || "";
  if (me.profile) { f.name.value = me.profile.name || ""; f.shareName.checked = !!me.profile.shareName; }
}

// ================= Forms (mh chips + questionnaire) =================
async function buildForms() {
  META = (await api("/api/meta")).body;
  const flags = ["bipolar", "anxiety", "depression", "adhd", "ocd", "ptsd"];
  $("#mh").innerHTML = flags.map((f) => `<span class="opt" data-mh="${f}">${f}</span>`).join("") + `<span class="opt" data-mh="none">none</span>`;
  $("#mh").querySelectorAll("[data-mh]").forEach((el) => el.addEventListener("click", () => {
    const f = el.dataset.mh;
    if (f === "none") { selectedMH.clear(); $("#mh").querySelectorAll(".sel").forEach((x) => x.classList.remove("sel")); }
    else { selectedMH.has(f) ? selectedMH.delete(f) : selectedMH.add(f); el.classList.toggle("sel"); }
  }));
  QUESTION_CACHE = (await api("/api/questions")).body.questions;
  MORAL_CACHE = (await api("/api/moral-questions")).body?.questions || [];
  let lastCat = null;
  $("#questions").innerHTML = QUESTION_CACHE.map((q, n) => {
    const header = q.category !== lastCat ? `<div class="quiz-head">${esc(q.category)} <span class="hint">quiz</span></div>` : "";
    lastCat = q.category;
    return `${header}<div class="q" data-qid="${q.id}">
      <p><span class="q-num">${n + 1}.</span> ${esc(q.prompt)}</p>${questionBodyHTML(q)}</div>`;
  }).join("");
  $("#questions").querySelectorAll(".q").forEach((qEl) => wireQuestion(qEl, byId(qEl.dataset.qid)));
}

let QUESTION_CACHE = [];
let MORAL_CACHE = [];
const byId = (id) => QUESTION_CACHE.find((q) => q.id === id);
// A game's "first, about you" question can come from either bank — the morality
// game asks a morality question. Returns { q, bank }.
function selfQuestion(game) {
  if (game.selfBank === "moral") return { q: MORAL_CACHE.find((x) => x.id === game.selfQ), bank: "moral" };
  return { q: byId(game.selfQ), bank: "traits" };
}

// Full-width stacked option buttons; tiered questions expand a finer row.
function questionBodyHTML(q) {
  if (q.type === "tiered") {
    return `<div class="opts tiers">${q.tierGroups.map((t, ti) => `<span class="opt tier" data-tier="${ti}">${esc(t.label)}</span>`).join("")}</div>
            <div class="opts fine" hidden></div>`;
  }
  return `<div class="opts">${q.options.map((o, i) => `<span class="opt" data-i="${i}">${esc(o.label)}</span>`).join("")}</div>`;
}

// Wire a rendered question element. Calls onAnswer(index) when a final value is chosen.
function wireQuestion(qEl, q, onAnswer) {
  if (!q) return;
  const choose = (opts, i) => {
    opts.querySelectorAll(".opt").forEach((o) => o.classList.remove("sel"));
    opts.querySelector(`[data-i="${i}"]`)?.classList.add("sel");
    qEl.dataset.answer = i;
    onAnswer?.(Number(i));
  };
  if (q.type === "tiered") {
    const tierRow = qEl.querySelector(".tiers");
    const fineRow = qEl.querySelector(".fine");
    tierRow.querySelectorAll(".tier").forEach((tierEl) => tierEl.addEventListener("click", () => {
      tierRow.querySelectorAll(".tier").forEach((t) => t.classList.remove("sel"));
      tierEl.classList.add("sel");
      const g = q.tierGroups[Number(tierEl.dataset.tier)];
      fineRow.hidden = false;
      const opts = [];
      for (let i = g.from; i < g.from + g.count; i++) opts.push(i);
      fineRow.innerHTML = (g.count > 1 ? `<span class="fine-label">exactly how many?</span>` : "") +
        opts.map((i) => `<span class="opt" data-i="${i}">${esc(q.options[i].label)}</span>`).join("");
      if (g.count === 1) { qEl.dataset.answer = g.from; onAnswer?.(g.from); }
      else delete qEl.dataset.answer;
      fineRow.querySelectorAll(".opt").forEach((opt) => opt.addEventListener("click", () => choose(fineRow, opt.dataset.i)));
    }));
  } else {
    const opts = qEl.querySelector(".opts");
    opts.querySelectorAll(".opt").forEach((opt) => opt.addEventListener("click", () => choose(opts, opt.dataset.i)));
  }
}

$("#onboard-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const answers = {};
  $("#questions").querySelectorAll(".q").forEach((q) => { if (q.dataset.answer != null) answers[q.dataset.qid] = Number(q.dataset.answer); });
  const [gender, genderIdentity] = (f.gender.value || "woman|woman-cis").split("|");
  const ratingsFrom = document.querySelector('input[name=ratingsFrom]:checked')?.value || "everyone";
  const predMoved = $("#pred-readout").classList.contains("set");
  const payload = {
    name: f.name.value,
    shareName: !!f.shareName?.checked,
    age: f.age.value, gender, genderIdentity, orientation: f.orientation.value, ratingsFrom,
    prediction: predMoved ? f.prediction.value : null,
    mentalHealth: [...selectedMH],
    socials: { instagram: f.instagram.value, tiktok: f.tiktok?.value, twitter: f.twitter?.value },
    confirmedAdult: [...$("#confirms").querySelectorAll("[data-confirm]")].every((c) => c.checked),
  };
  if (onboardRole === "voter" && !me.profile) {
    // A voter's profile carries demographics only — no photo, nothing to review.
    payload.photo = undefined;
  }
  const photo = photoData || f.photo.value;
  if (photo) payload.photo = photo; // keep existing photo when editing without a new one
  if (idData) payload.idDocument = idData;
  if (Object.keys(answers).length) payload.answers = answers;
  const { status, body } = await post("/api/profile", payload);
  if (status === 422 && body?.profile) {
    // Screened out before it ever reached the review queue (e.g. declared under 18).
    me.profile = body.profile;
    renderPhotoStatus();
    alert(`Photo rejected: ${body.error}`);
    window.scrollTo(0, 0);
    return;
  }
  if (status >= 400) { alert(body?.error || "Couldn't submit — check your photo size."); return; }
  me.profile = body;
  idData = null;
  setCredits(body.credits);
  renderPhotoStatus();
  show("home");
  if (body.hasPhoto && body.photoStatus === "pending") {
    toast("⏳ Submitted — it goes live once a human approves it.");
  } else if (!body.hasPhoto) {
    toast("You're in. Start rating.");
  }
});

// ================= Home =================
async function loadHome() {
  const p = me.profile || {};
  $("#acct-email").textContent = me.account?.email || "";
  $("#photo-meta").textContent = `${p.matchups || 0} matchups →`;
  $("#edit-profile").onclick = () => show("onboard");

  // Two big face cards, filled with a real preview pair per gender.
  const cards = await Promise.all(["woman", "man"].map(async (g) => {
    const { status, body } = await api(`/api/matchup?gender=${g}`);
    const label = g === "woman" ? "Women's faces" : "Men's faces";
    const pair = status < 400 && body.a
      ? `<span class="face-split">${avatar(body.a)}${avatar(body.b)}<span class="face-vs">VS</span></span>`
      : `<span class="face-split"><span class="avatar"></span><span class="avatar"></span><span class="face-vs">VS</span></span>`;
    const pairs = status < 400 ? (body.a.matchups || 0) + (body.b.matchups || 0) : 0;
    return `<button class="face-card" data-rate="${g}">${pair}
      <span class="face-foot"><span><b>${label}</b><small>${pairs} pairs so far</small></span><span class="go">Rate →</span></span>
    </button>`;
  }));
  $("#face-cards").innerHTML = cards.join("");
  $("#face-cards").querySelectorAll("[data-rate]").forEach((el) =>
    el.addEventListener("click", () => { rateGender = el.dataset.rate; show("matchup"); loadMatchup(); }));

  $("#dilemma-grid").querySelectorAll("[data-dilemma]").forEach((el) => {
    el.onclick = () => loadDilemma(el.dataset.dilemma);
  });

  // The home tile shows your live standing, so the leaderboard is a pull rather
  // than something you have to go looking for.
  const board = (await api("/api/leaderboard")).body;
  const meta = $("#standing-meta");
  if (meta) {
    meta.textContent = !board?.isParticipant ? "voters aren't ranked →"
      : !board.you ? "where you rank →"
      : !board.you.ranked ? `${board.you.toGo} more matchups →`
      : board.you.inTopTen ? `you're #${board.you.rank} →`
      : `#${board.you.rank.toLocaleString()} · top ${board.you.percentile}% →`;
  }

  const link = `${location.origin}/?ref=${me.account?.id?.slice(0, 8) || ""}`;
  $("#refer-link").value = link;
  $("#refer-copy").onclick = () => { navigator.clipboard?.writeText(link); $("#refer-copy").textContent = "copied ✓"; };
  renderGameGrid();
}

// ================= Buy credits =================
async function loadBuy() {
  $("#balance").textContent = me.profile?.credits ?? 0;
  const { packs } = (await api("/api/credit-packs")).body;
  $("#packs").innerHTML = packs.map((p) => `<div class="pack ${p.popular ? "popular" : ""}">
    ${p.popular ? `<div class="tag-popular">MOST POPULAR</div>` : ""}
    <div class="price">$${p.price}</div>
    <div class="amount">${p.credits.toLocaleString()} ✦${p.badge ? `<span class="save">${esc(p.badge)}</span>` : ""}</div>
    <div class="eq">Equivalent to ${esc(p.ratingsEq)}</div>
    <button class="buy" data-pack="${p.id}">Buy</button>
  </div>`).join("");
  $("#packs").querySelectorAll("[data-pack]").forEach((b) => b.addEventListener("click", async () => {
    b.disabled = true;
    const { body } = await post("/api/buy-credits", { packId: b.dataset.pack });
    if (body?.credits != null) {
      setCredits(body.credits);
      me.profile.credits = body.credits;
      $("#balance").textContent = body.credits;
      b.textContent = `+${body.added} ✦ added`;
      setTimeout(() => { b.textContent = "Buy"; b.disabled = false; }, 1400);
    } else b.disabled = false;
  }));
}

// ================= Game grid (with accuracy) =================
async function renderGameGrid() {
  const stats = (await api("/api/guess-stats")).body || {};
  const reward = META.game?.reward ?? 2;
  $("#game-grid").innerHTML = (META.games || []).map((g) => {
    const acc = stats[g.axis]?.accuracy;
    return `<button class="round-tile" data-game="${g.key}">
      <span class="ico">${g.emoji || "🎲"}</span>
      <h4>${esc(g.label)}</h4>
      <span class="tile-foot"><b>+${reward} credits</b><span>${acc == null ? "—" : acc + "% right"}</span></span>
    </button>`;
  }).join("");
  $("#game-grid").querySelectorAll("[data-game]").forEach((el) => el.addEventListener("click", () => playGame(el.dataset.game)));
}

// ================= Matchup =================
document.querySelectorAll("[data-rate]").forEach((b) => b.addEventListener("click", () => { rateGender = b.dataset.rate; show("matchup"); loadMatchup(); }));
let rateGender = null;
async function loadMatchup() {
  renderTasteProgress();
  const { status, body } = await api(`/api/matchup${rateGender ? "?gender=" + rateGender : ""}`);
  if (status >= 400) { $("#matchup").innerHTML = ""; $("#matchup-empty").hidden = false; return; }
  $("#matchup-empty").hidden = true;
  $("#matchup").innerHTML = [body.a, body.b].map((u, i) => withFlag(`<button class="vs-card pick" type="button"
      data-win="${u.id}" data-lose="${u.id === body.a.id ? body.b.id : body.a.id}">
      <span class="vs-photo">${avatar(u)}${u.age ? `<span class="vs-name">${u.age}</span>` : ""}</span>
      <span class="pick-hint">click, or <b>${i === 0 ? "←" : "→"}</b></span></button>`, u.id)).join("")
    + `<span class="vs-badge">VS</span>`;
  $("#matchup").querySelectorAll(".pick").forEach((btn) => btn.addEventListener("click", async () => {
    const before = me.profile.votesCast || 0;
    const { body: res } = await post("/api/vote", { winnerId: btn.dataset.win, loserId: btn.dataset.lose });
    if (res?.credits != null) { setCredits(res.credits); me.profile.credits = res.credits; }
    if (res?.votesCast != null) { me.profile.votesCast = res.votesCast; announceTasteUnlock(before, res.votesCast); }
    loadMatchup();
  }));
  // ←/→ pick the left/right photo.
  const picks = $("#matchup").querySelectorAll(".pick");
  versusKeys = (side) => picks[side === "a" ? 0 : 1]?.click();
  renderRateExtras();
}

// The live "Your type" panel + personal ranking shown under the rating pair.
async function renderRateExtras() {
  const genderWord = rateGender === "man" ? "men" : rateGender === "woman" ? "women" : "people";
  const r = (await api("/api/report")).body;
  if (r?.taste) {
    const next = r.taste.find((t) => !t.unlocked);
    $("#rate-taste").innerHTML = `<div class="section-title">🧬 Your type in ${genderWord} <span class="hint">— firms up as you rate</span></div>
      <div class="meta" style="margin:0 0 8px 2px">${r.votesCast} pairs rated${next ? ` · next unlock at ${next.unlockAt}` : " · all unlocked ✓"}</div>
      ${tasteSection(r.taste).replace(/^<div class="section-title">[^<]*<[^>]*>[^<]*<\/span><\/div>/, "")}`;
  }
  const rk = (await api("/api/my-ranking")).body;
  if (rk) renderRanking(rk, genderWord);
}
function renderRanking(rk, genderWord) {
  const el = $("#rate-ranking");
  if (!rk.ranking.length) { el.innerHTML = `<div class="section-title">🏆 Your ranking</div><p class="meta" style="margin:0 2px">Pick a few and your personal ranking of ${esc(genderWord)} builds here.</p>`; return; }
  const medal = (i) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "");
  const cards = rk.ranking.map((row, i) => `<div class="rank-card">
      <span class="rank-no">#${i + 1} ${medal(i)}</span>${avatar(row.user)}
    </div>`).join("");
  el.innerHTML = `<div class="section-title">🏆 Your ranking <span class="hint">— from your ${rk.votesCast} votes</span></div>
    <div class="rank-grid">${cards}</div>`;
}
// Show progress toward the next taste-card unlock.
function renderTasteProgress() {
  const el = $("#taste-progress");
  if (!el) return;
  const votes = me.profile?.votesCast || 0;
  const next = (META.tastes || []).filter((t) => votes < t.unlockAt).sort((a, b) => a.unlockAt - b.unlockAt)[0];
  el.innerHTML = next
    ? `Rate ${next.unlockAt - votes} more to unlock <b>${esc(next.title)}</b> in your report`
    : `All taste cards unlocked ✓ — see them in your report`;
}
function announceTasteUnlock(before, after) {
  (META.tastes || []).forEach((t) => { if (before < t.unlockAt && after >= t.unlockAt) toast(`🔓 Unlocked: ${t.title}`); });
  renderTasteProgress();
}

// ================= Report ("How people see your photo") =================
async function loadReport() {
  const r = (await api("/api/report")).body;
  if (!r) return ($("#report").innerHTML = `<p class="empty">Not available.</p>`);
  setCredits(r.credits);
  const p = me.profile || {};
  const a = r.attractiveness;
  const traits = (arr) => arr.map((t) => `<span class="pill">${esc(t.label)}</span>`).join("") || `<span class="meta">not enough data yet</span>`;

  // Attractiveness
  const attract = `<div class="card attract"><div class="section-title" style="margin-top:0">✨ Attractiveness</div>
    <div class="report-head">
      <div class="ph">${avatar(p)}</div>
      <div>
        <div>chosen more than <b class="range">${a.low}–${a.high}%</b> of photos</div>
        <div class="meta">ranked among ${a.established.toLocaleString()} established photos · Elo ${r.elo}</div>
        ${r.prediction != null ? `<div class="meta" style="margin-top:4px">you predicted <b>${r.prediction}%</b> · strangers rate you <b>${a.percentile}%</b></div>` : ""}
        <div class="progress"><i style="width:${Math.round((a.pairs / a.pairsTarget) * 100)}%"></i></div>
        <div class="meta">${a.pairs} / ${a.pairsTarget} pairs · ${Math.max(0, a.pairsTarget - a.pairs)} still coming in</div>
        <button class="buy-btn" id="buy-pairs">+${META.pairsAmount} pairs · ${r.cost.pairs}✦</button>
      </div>
    </div></div>`;

  // What strangers guess about your photo
  const guessRows = r.games.map((g) => {
    let right;
    if (g.revealed && g.result) right = `<span class="reveal-val">${esc(g.result.pole)} · ${g.result.pct}%</span>`;
    else if (g.ready) {
      const s = shortfall(r.cost.reveal, r.credits);
      right = s
        ? `<button class="reveal-btn short" data-reveal="${g.key}" title="${s.short}✦ short — about ${s.ratings.toLocaleString()} more ratings">reveal · ${r.cost.reveal}✦ <small>(${s.short}✦ short)</small></button>`
        : `<button class="reveal-btn" data-reveal="${g.key}">reveal · ${r.cost.reveal}✦</button>`;
    }
    else right = `<button class="reveal-btn collecting" data-play-game="${g.key}">still collecting · play →</button>`;
    return `<div class="guess-row"><span class="g-name">${g.emoji || ""} ${esc(g.label)}</span>${right}</div>`;
  }).join("");
  const guesses = `<div class="card"><div class="section-title" style="margin-top:0">🔮 What strangers guess about your photo</div>
    ${guessRows}<p class="meta" style="margin:12px 0 0">From direct guesses in the games. The more you <b>play &amp; rate</b>, the more your photo is shown to others.</p></div>`;

  // The unsoftened numbers. This goes first, before anything reassuring.
  const brutal = brutalCard(r);

  // The four mirrors.
  const mirrors = compatibilityCard(r) + selfVsCrowdCard(r) + reciprocityCard(r) + scatterCard(r);

  // Human Nature score.
  const nature = natureCard(r);

  // Who Likes You?
  const fans = r.fans.unlocked ? fansCard(r.fans.report) : lockedFansCard(r.fans, r.credits);

  // Your type + where you stand
  const st = r.standing;
  const standingTile = !st ? ""
    : st.ranked
      ? `<div class="card"><div class="stat"><b>#${st.rank.toLocaleString()}</b><span class="meta">of ${st.of.toLocaleString()} ranked · top ${st.percentile}%</span></div>
           <button class="outline" style="width:100%;margin-top:8px" id="go-boards">open the Top 10 →</button></div>`
      : `<div class="card"><div class="stat"><b>${st.toGo}</b><span class="meta">more matchups until you're ranked</span></div></div>`;

  const extra = `<div class="section-title">Your type <span class="hint">— learned from the photos you chose</span></div>
    <div class="card"><p style="margin:0;font-size:17px">${esc(r.yourType.text)}</p></div>
    <div class="cards">
      ${standingTile}
      <div class="card"><div class="stat"><b>${r.winRate == null ? "—" : r.winRate + "%"}</b><span class="meta">of your matchups end in a win</span></div></div>
    </div>
    <label class="email-pref" style="margin-top:14px"><input type="checkbox" id="email-pref" ${r.emailOnNewData ? "checked" : ""}/> email me when new data is available</label>`;

  $("#report").innerHTML = trueNatureCard(r, p) + brutal + attract + mirrors + nature + tasteSection(r.taste) + guesses + fans + extra;

  $("#tn-share")?.addEventListener("click", () => shareTrueNature(r));
  $("#go-boards")?.addEventListener("click", () => show("boards"));
  $("#go-moral")?.addEventListener("click", () => show("moral"));
  $("#buy-pairs")?.addEventListener("click", () => spendAction("/api/buy-pairs", {}, r.cost.pairs));
  $("#report").querySelectorAll("[data-reveal]").forEach((b) => b.addEventListener("click", () => spendAction("/api/reveal", { game: b.dataset.reveal }, r.cost.reveal)));
  $("#report").querySelectorAll("[data-play-game]").forEach((b) => b.addEventListener("click", () => playGame(b.dataset.playGame)));
  $("#unlock-fans")?.addEventListener("click", () => spendAction("/api/unlock-fans", {}, r.cost.fans));
  wireShortfalls($("#report"));
  $("#email-pref")?.addEventListener("change", (e) => post("/api/email-pref", { on: e.target.checked }));
}

// The numbers with the padding taken out: how often you actually win, where you
// actually rank, how many people passed you over, and how wrong you were about
// yourself. Nothing here is estimated — it's all counted.
function brutalCard(r) {
  if (!r.matchups) {
    return `<div class="card brutal"><div class="section-title" style="margin-top:0">📉 The numbers</div>
      <p style="margin:0">Nobody has rated your photo yet. Come back once strangers have had a look.</p></div>`;
  }
  const rank = r.rank
    ? `<div class="brutal-stat"><b>#${r.rank.rank.toLocaleString()}</b>
         <span>of ${r.rank.of.toLocaleString()} rated photos</span>
         <small>${r.rank.fromBottom.toLocaleString()} ${r.rank.fromBottom === 1 ? "person is" : "people are"} below you</small></div>` : "";
  const win = r.winRate != null
    ? `<div class="brutal-stat"><b>${r.winRate}%</b><span>of your matchups end in a win</span>
         <small>${r.wins.toLocaleString()} won · ${r.losses.toLocaleString()} lost</small></div>` : "";
  const passed = `<div class="brutal-stat"><b>${r.abandonedBy.toLocaleString()}</b>
      <span>${r.abandonedBy === 1 ? "person has" : "people have"} picked you before, then chosen someone else over you</span>
      <small>${r.rejectedBy.toLocaleString()} passed on you at all · ${r.chosenBy.toLocaleString()} ever picked you</small></div>`;

  // The self-prediction, finally used for something.
  let pred = "";
  if (r.prediction) {
    const d = r.prediction;
    const line = d.gap === 0 ? "You called it exactly."
      : d.overrated
        ? `You said <b>${d.predicted}</b>. They say <b>${d.actual}</b>. You overrated yourself by <b>${d.gap}</b> points.`
        : `You said <b>${d.predicted}</b>. They say <b>${d.actual}</b>. You <i>underrated</i> yourself by <b>${Math.abs(d.gap)}</b> points.`;
    const where = d.rankAmongDelusional
      ? `<div class="meta">That's the ${ordinal(d.rankAmongDelusional)}-biggest gap of ${d.ofDelusional.toLocaleString()} people who guessed.</div>` : "";
    pred = `<div class="brutal-pred">${line}${where}</div>`;
  }

  // The two dilemma verdicts, once enough people have weighed in.
  const dilemmas = [
    r.death?.leftPct != null && r.death.total >= 5
      ? `<div class="brutal-verdict">🪦 <b>${r.death.leftPct}%</b> of people who had to choose left you to die. <span class="meta">${r.death.total} choices</span></div>` : "",
    r.cheat?.yesPct != null && r.cheat.total >= 5
      ? `<div class="brutal-verdict">💔 <b>${r.cheat.yesPct}%</b> would cheat on their partner for you. <span class="meta">${r.cheat.total} answers</span></div>` : "",
  ].join("");

  return `<div class="card brutal"><div class="section-title" style="margin-top:0">📉 The numbers</div>
    <div class="brutal-grid">${rank}${win}${passed}</div>${pred}${dilemmas}</div>`;
}
const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

// ---- Compatibility Gap ----
// Two bars: the average attractiveness percentile of who you pick, against the
// average of who picks you. No advice, no softening — they line up or they don't.
function compatibilityCard(r) {
  const g = r.compatibilityGap;
  if (!g || g.gap == null) {
    return `<div class="card"><div class="section-title" style="margin-top:0">↔️ Compatibility Gap</div>
      <p class="meta" style="margin:0">Not enough votes yet — you need to pick some people, and some people need to pick you.</p></div>`;
  }
  const bar = (label, pct, cls) => `<div class="gap-row">
      <div class="gap-label"><span>${label}</span><b>${pct}</b></div>
      <div class="gap-track"><i class="${cls}" style="width:${Math.max(2, pct)}%"></i></div>
    </div>`;
  return `<div class="card"><div class="section-title" style="margin-top:0">↔️ Compatibility Gap</div>
    ${bar("Your Type", g.yourType, "type")}
    ${bar("Your Fans", g.yourFans, "fans")}
    <p class="gap-verdict">${esc(g.verdict)}</p>
    <p class="meta">Average attractiveness percentile of the people you pick, against the people who pick you. A gap of ${Math.abs(g.gap)} points.</p>
  </div>`;
}

// ---- Self-Report vs. Reality ----
// Your answer on the left, the crowd's read on the right, every axis, no
// commentary. The title does the work.
function selfVsCrowdCard(r) {
  const rows = (r.selfVsCrowd || []).map((a) => {
    const crowd = a.crowd ? a.crowd.pct : null;
    const delta = crowd == null ? null : Math.abs(a.self - crowd);
    return `<div class="mirror-row">
      <div class="mirror-head"><span>${a.emoji || ""} ${esc(a.label)}</span>${delta != null ? `<b class="${delta >= 30 ? "wide" : ""}">${delta} apart</b>` : `<span class="meta">no consensus yet</span>`}</div>
      <div class="mirror-bars">
        <div class="mirror-bar self"><span style="width:${a.self}%"></span><i>${a.self}</i></div>
        <div class="mirror-bar crowd">${crowd == null ? `<em>—</em>` : `<span style="width:${crowd}%"></span><i>${crowd}</i>`}</div>
      </div>
      <div class="mirror-poles"><span>${esc(a.poles[0])}</span><span>${esc(a.poles[1])}</span></div>
    </div>`;
  }).join("");
  return `<div class="card mirror-card">
    <div class="section-title" style="margin-top:0">🪞 Who you think you are / Who you look like</div>
    <div class="mirror-key"><span class="k self">you said</span><span class="k crowd">strangers guessed</span></div>
    ${rows}
  </div>`;
}

// ---- Reciprocity ----
function reciprocityCard(r) {
  const rec = r.reciprocity;
  if (!rec || rec.rate == null || !rec.chosen) {
    return `<div class="card"><div class="section-title" style="margin-top:0">🔁 Reciprocity</div>
      <p class="meta" style="margin:0">Pick a few more people and this fills in.</p></div>`;
  }
  return `<div class="card"><div class="section-title" style="margin-top:0">🔁 Reciprocity</div>
    <div class="recip"><b>${rec.rate}%</b>
      <span>${rec.back} of the ${rec.chosen} people you chose also chose you</span></div>
    ${rec.percentile != null ? `<p class="meta">That rate is higher than ${rec.percentile}% of everyone on the platform.</p>` : ""}
    <p class="meta">Not a measure of how attractive you are — a measure of whether the people you want are the people who want you.</p>
  </div>`;
}

// ---- Morality vs. Attractiveness ----
// Inline SVG, no chart library. Every qualifying user is a dot; yours is the
// one in a different colour. No trend line and no caption — draw your own.
function scatterCard(r) {
  const d = r.moralityVsLooks;
  if (!d || d.points.length < 3) {
    return `<div class="card"><div class="section-title" style="margin-top:0">📈 Morality vs. Attractiveness</div>
      <p class="meta" style="margin:0">Needs a few more people with a finished quiz and ${d?.minMatchups ?? 50}+ matchups.</p></div>`;
  }
  const W = 320, H = 240, PAD = 34;
  // x: nature score -72..72 → left..right. y: percentile 0..100 → bottom..top.
  const px = (x) => PAD + ((x + 72) / 144) * (W - PAD - 8);
  const py = (y) => H - PAD - (y / 100) * (H - PAD - 10);
  const dots = d.points.map((p) =>
    `<circle cx="${px(p.x).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="${p.you ? 6 : 3.5}" class="${p.you ? "dot you" : "dot"}" />`).join("");
  return `<div class="card"><div class="section-title" style="margin-top:0">📈 Morality vs. Attractiveness</div>
    <div class="scatter-wrap">
      <svg viewBox="0 0 ${W} ${H}" class="scatter" role="img" aria-label="Morality score against attractiveness percentile, one dot per user">
        <line x1="${PAD}" y1="${H - PAD}" x2="${W - 6}" y2="${H - PAD}" class="axis" />
        <line x1="${PAD}" y1="8" x2="${PAD}" y2="${H - PAD}" class="axis" />
        <line x1="${px(0)}" y1="8" x2="${px(0)}" y2="${H - PAD}" class="zero" />
        ${dots}
        <text x="${PAD}" y="${H - 10}" class="ax">better</text>
        <text x="${W - 6}" y="${H - 10}" class="ax" text-anchor="end">worse</text>
        <text x="0" y="14" class="ax">100th</text>
        <text x="0" y="${H - PAD}" class="ax">0</text>
      </svg>
      <div class="scatter-legend">
        <span>← morality score →</span>
        <span class="you-key">your dot</span>
      </div>
    </div>
    <p class="meta">${d.points.length} people with a finished morality quiz and at least ${d.minMatchups} matchups. Vertical axis is attractiveness percentile.</p>
  </div>`;
}

// The Human Nature score: the verdict band, the six vices, and where you sit
// against everyone else. This is the card built to be screenshotted.
function natureCard(r) {
  const n = r.nature || {};
  if (!n.answered) {
    return `<div class="card nature-card"><div class="section-title" style="margin-top:0">🧬 Your Human Nature score</div>
      <p style="margin:0 0 10px">You haven't taken the morality quiz. Until you do, your score is 0 and <b>nobody can match with you</b>.</p>
      <button class="primary" id="go-moral">take the morality quiz →</button></div>`;
  }
  const v = n.verdict || {};
  const rows = Object.entries(n.breakdown || {}).map(([key, b]) => {
    const pos = b.max ? Math.round(((b.score / b.max + 1) / 2) * 100) : 50;
    return `<div class="nature-row">
      <div class="nature-label"><span>${esc(b.ends?.[0] || "")}</span><b>${b.emoji || ""} ${esc(b.label)} ${b.score > 0 ? "+" : ""}${b.score}</b><span>${esc(b.ends?.[1] || "")}</span></div>
      <div class="track"><i class="knob" style="left:${Math.max(0, Math.min(100, pos))}%"></i></div>
    </div>`;
  }).join("");
  const worst = n.worst ? `<p class="meta">Your worst showing was <b>${esc(n.worst.label)}</b> (${n.worst.score > 0 ? "+" : ""}${n.worst.score} of a possible +${n.worst.max}).</p>` : "";
  const rank = n.harsherThan != null
    ? `<p class="nature-rank">You answered worse than <b>${n.harsherThan}%</b> of everyone who has taken this quiz.</p>` : "";
  const incomplete = n.complete ? "" :
    `<p class="meta">${n.answered} of ${n.total} answered — the rest will move this number.</p>`;
  return `<div class="card nature-card"><div class="section-title" style="margin-top:0">🧬 Your Human Nature score</div>
    <div class="nature-score"><b>${n.score > 0 ? "+" : ""}${n.score}</b><span class="verdict-band">${esc(v.label || "")}</span></div>
    <p class="verdict-line">${esc(v.line || "")}</p>
    ${rank}${worst}${incomplete}
    <p class="meta">You can only match with someone whose score is within <b>${n.window}</b> points of yours.</p>
    ${rows}
    <button class="outline" style="width:100%;margin-top:12px" id="go-moral">${n.complete ? "review your answers" : "finish the quiz"} →</button></div>`;
}

// People you both like who haven't cleared the remaining gates yet.
function lockedFansCard(f, credits) {
  const pct = Math.min(100, Math.round((credits / f.cost) * 100));
  return `<div class="card locked-card">
    <div class="section-title" style="color:#fff;margin-top:0">💘 Who Likes You?</div>
    <p>A full demographic report on the people who pick your photo. We compare everyone who picks you against everyone who passes:</p>
    <ul>
      <li>their politics, income, and dominance</li>
      <li>mental health — which diagnoses are overrepresented among your fans</li>
      <li>their bodycount &amp; gooner lean, gender, and age</li>
      <li>how their type compares to the average voter</li>
    </ul>
    <button class="unlock-btn" id="unlock-fans">🔒 unlock your full demographic report · ${f.cost}✦</button>
    <div class="progress" style="background:rgba(255,255,255,.25)"><i style="width:${pct}%;background:#fff"></i></div>
    <div class="earn-line">${credits}✦ of ${f.cost}✦ earned — <b>rate photos</b> or <b>play rounds</b> to unlock it.</div>
    ${shortfallHtml(f.cost, credits)}
  </div>`;
}
function fansCard(rep) {
  const mh = rep.mentalHealth.length
    ? rep.mentalHealth.map((m) => `<span class="pill">${esc(m.flag)} · ${m.lift}× (${m.pct}%)</span>`).join("")
    : `<span class="meta">no diagnosis stands out yet</span>`;
  const traits = rep.traits.map((t) => `<span class="pill">${esc(t.label)}</span>`).join("") || `<span class="meta">not enough data</span>`;
  const g = Object.entries(rep.genderSplit || {}).map(([k, v]) => `${k} ${v}`).join(" · ") || "—";
  return `<div class="card"><div class="section-title" style="margin-top:0">💘 Who Likes You? <span class="hint">— ${rep.fans} fans</span></div>
    <p class="meta" style="margin:0 0 4px">Overrepresented among your fans</p><div>${mh}</div>
    <p class="meta" style="margin:12px 0 4px">Their politics / beliefs / personality</p><div>${traits}</div>
    <p class="meta" style="margin:12px 0 0">Fans by gender: ${esc(g)}${rep.avgAge ? " · avg age " + rep.avgAge : ""}</p></div>`;
}

// Spend credits then refresh the report.
async function spendAction(url, body, cost = null) {
  const { status, body: res } = await post(url, body);
  if (status === 402) {
    // Say exactly how short they are and exactly how long the grind is, then
    // offer the shortcut. Honest numbers, no invented urgency.
    const s = cost != null ? shortfall(cost, res?.credits ?? me.profile?.credits) : null;
    toast(s
      ? `${s.short}✦ short — ${s.ratings.toLocaleString()} more ratings, or buy.`
      : "Not enough credits.");
    if (s) show("buy");
    return;
  }
  if (res?.credits != null) { setCredits(res.credits); me.profile.credits = res.credits; }
  loadReport();
}

// ================= Shareable "True Nature" card =================
function tasteBlurb(taste = []) {
  const on = taste.filter((t) => t.unlocked);
  if (!on.length) return null;
  const g = on[0].gender;
  const poles = on.map((t) => t.pole.replace(/-/g, " ")).slice(0, 4).join(", ");
  return { poles, gender: g };
}
function trueNatureVerdict(r) {
  const a = r.attractiveness;
  const t = tasteBlurb(r.taste);
  const looks = a.percentile >= 50
    ? `Strangers rate you hotter than ${a.percentile}% of people.`
    : `Strangers rate you below ${100 - a.percentile}% of people.`;
  const type = t ? `You go for <b>${esc(t.poles)} ${esc(t.gender)}</b>.` : `Rate more people to expose your type.`;
  let jab = "";
  if (r.prediction != null) {
    const gap = r.prediction - a.percentile;
    if (gap >= 15) jab = `You guessed ${r.prediction}%. Bit of an ego. 💀`;
    else if (gap <= -15) jab = `You guessed ${r.prediction}% — you're hotter than you think.`;
  }
  return { looks, type, jab };
}
function trueNatureCard(r, p) {
  const v = trueNatureVerdict(r);
  return `<div class="card true-nature">
    <div class="tn-tag">YOUR TRUE NATURE</div>
    <div class="tn-head">${avatar(p, "tn-ph")}<div>
      <div class="tn-type">${v.type}</div>
      <div class="tn-looks">${esc(v.looks)}</div>
      ${v.jab ? `<div class="tn-jab">${v.jab}</div>` : ""}
    </div></div>
    <button class="tn-share" id="tn-share">📸 copy my card to share</button>
    <div class="tn-foot">truehumannature.com · nobody's watching. be honest.</div>
  </div>`;
}
async function shareTrueNature(r) {
  const v = trueNatureVerdict(r);
  const strip = (s) => s.replace(/<[^>]+>/g, "");
  const text = `MY TRUE NATURE (truehumannature.com)\n${strip(v.type)}\n${v.looks}${v.jab ? "\n" + strip(v.jab) : ""}`;
  try {
    if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); toast("Copied — go expose yourself 😈"); }
  } catch { try { await navigator.clipboard.writeText(text); toast("Copied to clipboard"); } catch { toast("Couldn't copy"); } }
}

// ================= Your taste (from rating) =================
function tasteSection(taste = []) {
  const cards = taste.map((t) => {
    if (!t.unlocked) {
      return `<div class="card taste-card locked"><div class="taste-title">${t.emoji} ${esc(t.title)}</div>
        <div class="taste-line">🔒 rate <b>${t.votesToGo}</b> more ${t.votesToGo === 1 ? "person" : "people"} to unlock</div></div>`;
    }
    const val = `${t.value >= 0 ? "+" : ""}${t.value}${t.unit ? " " + esc(t.unit) : ""}`;
    return `<div class="card taste-card"><div class="taste-title">${t.emoji} ${esc(t.title)}</div>
      <div class="taste-line">${esc(t.verb)} <b>${esc(t.pole)} ${esc(t.gender)}</b> — more than <b>${t.pct}%</b> of raters</div>
      <div class="slider-viz">
        <div class="slider-val" style="left:${t.position}%">${esc(val)}</div>
        <div class="track"><span class="tick"></span><span class="knob" style="left:${t.position}%"></span></div>
        <div class="ends"><span>${esc(t.ends[0])}</span><span>average</span><span>${esc(t.ends[1])}</span></div>
      </div></div>`;
  }).join("");
  return `<div class="section-title">💘 Your taste <span class="hint">— from the people you rate</span></div>${cards}`;
}

function toast(msg) {
  let t = $("#toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2600);
}

// ================= Matches (socials only) =================
// ================= Credit pressure =================
// Everywhere something is locked, say exactly how short you are and exactly how
// long the grind is. The numbers are real — a true "900 more ratings" sells the
// purchase better than a fake countdown, and it can't be screenshotted as a scam.
function shortfall(cost, credits) {
  const have = credits || 0;
  const short = Math.max(0, cost - have);
  if (!short) return null;
  const perVote = 1 / (META.creditPerVotes || 50);
  const ratings = Math.ceil(short / perVote);
  const rounds = Math.ceil(short / (META.game?.reward || 2));
  return { have, cost, short, ratings, rounds };
}

function shortfallHtml(cost, credits) {
  const s = shortfall(cost, credits);
  if (!s) return "";
  return `<div class="shortfall">
      <b>${s.short}✦ short.</b> You have ${s.have}✦ of ${s.cost}✦.
      <div class="meta">That's ${s.ratings.toLocaleString()} more ratings, or ${s.rounds.toLocaleString()} perfect guessing rounds.</div>
      <button class="buy-btn" data-view="buy">buy credits instead →</button>
    </div>`;
}

// Wire any shortfall CTA rendered into a container.
function wireShortfalls(root) {
  root.querySelectorAll(".shortfall [data-view]").forEach((b) =>
    b.addEventListener("click", () => show(b.dataset.view)));
}

// ================= Legal =================
// Documents are readable without an account — nobody should have to sign up to
// find out what they'd be agreeing to.
async function openLegal(key, { acceptable = false } = {}) {
  const { status, body } = await api(`/api/legal/${key}`);
  if (status !== 200) return;
  $("#legal-title").textContent = `${body.title} · v${body.version}`;
  $("#legal-body").innerHTML = body.html;
  $("#legal-body").scrollTop = 0;
  $("#legal-foot").hidden = !acceptable;
  $("#legal-modal").hidden = false;
  return new Promise((resolve) => {
    const close = (ok) => { $("#legal-modal").hidden = true; resolve(ok); };
    $("#legal-close").onclick = () => close(false);
    $("#legal-accept").onclick = () => close(true);
  });
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-legal]");
  if (el) { e.preventDefault(); openLegal(el.dataset.legal); }
});

// A version bump forces re-acceptance before anything else works.
async function settleOutstanding(outstanding) {
  for (const key of outstanding) {
    const agreed = await openLegal(key, { acceptable: true });
    if (!agreed) { toast("You need to accept to keep using the site."); return false; }
  }
  const r = await post("/api/legal/accept", { docs: outstanding });
  if (r.status !== 200) return false;
  me.outstanding = r.body.outstanding;
  return true;
}

// ================= The Top 10 =================
// Ranked strictly by the share of matchups won. No opt-in, no opt-out, and
// everybody sees their own standing whether or not they made it.
async function loadBoards() {
  const wrap = $("#boards");
  const standing = $("#board-standing");
  const { status, body } = await api("/api/leaderboard");
  if (status === 503) { standing.innerHTML = ""; wrap.innerHTML = `<p class="empty">The leaderboard is switched off.</p>`; return; }
  if (status !== 200) return;

  standing.innerHTML = standingCard(body);
  standing.querySelector("[data-view]")?.addEventListener("click", (e) => show(e.target.dataset.view));

  wrap.innerHTML = body.boards.length
    ? body.boards.map(boardTable).join("")
    : `<p class="empty">Nobody has been rated ${body.minMatchups} times yet. The board opens as soon as they have.</p>`;
}

const GENDER_TITLE = { woman: "Women", man: "Men", nonbinary: "Nonbinary" };

function boardTable(board) {
  return `<div class="section-title">🏆 ${GENDER_TITLE[board.gender] || board.gender} — Top ${board.rows.length}</div>
    <div class="board-list">${board.rows.map((r) => `
      <div class="board-row${r.you ? " you" : ""}">
        <span class="board-rank">#${r.rank}</span>
        <span class="board-photo">${avatar(r)}</span>
        <span class="board-stats">
          <b>${r.winRate}%</b>
          <span class="meta">won · ${r.wins}W ${r.losses}L over ${r.matchups} pairs</span>
          ${socialLinks(r.socials)}
          ${r.you ? `<span class="board-you">that's you</span>` : ""}
        </span>
      </div>`).join("")}</div>
    <p class="meta" style="margin:6px 0 18px">of ${board.of} ranked ${GENDER_TITLE[board.gender]?.toLowerCase() || ""}</p>`;
}

// The card everyone outside the top ten sees — a real rank and a percentile.
function standingCard(body) {
  if (!body.isParticipant) {
    return `<div class="card board-status out">
      <b>You're a voter.</b>
      <div class="meta">Only participants — people with a photo in the pool — are ranked. Add a photo and you'll get a rank of your own.</div>
      <button class="outline" data-view="onboard" style="margin-top:10px">put my face in →</button>
    </div>`;
  }
  const you = body.you;
  if (!you) return "";
  if (!you.ranked) {
    return `<div class="card board-status out">
      <b>Not ranked yet.</b>
      <div class="meta">You need ${you.minMatchups} matchups to get a position — you're at ${you.matchups}. ${you.toGo} to go.</div>
    </div>`;
  }
  if (you.inTopTen) {
    return `<div class="card board-status in">
      <b>You're #${you.rank}.</b>
      <div class="meta">${you.winRate}% of your matchups end in a win — top ${you.percentile}% of ${you.of} ranked.</div>
    </div>`;
  }
  return `<div class="card board-status">
    <div class="standing-rank">You rank <b>#${you.rank.toLocaleString()}</b> of ${you.of.toLocaleString()}</div>
    <div class="standing-line"><b>${you.winRate}%</b> win rate · <b>Top ${you.percentile}%</b></div>
    <div class="meta">${you.wins.toLocaleString()} won, ${you.losses.toLocaleString()} lost across ${you.matchups.toLocaleString()} matchups.</div>
  </div>`;
}

// ================= Dilemma rounds =================
// Two-photo "you can only save one" and one-photo "would you cheat". No right
// answer, no accuracy — the point is what the target is told afterwards.
const DILEMMAS = {
  death: {
    title: "You can only save one",
    sub: "Both of them are going to die unless you choose. Pick who lives. They will be told how often they were the one you left.",
  },
  cheat: {
    title: "Would you cheat on your partner for this person?",
    sub: "Nobody is watching. They will be told what percentage of people said yes.",
  },
};
let dilemmaKind = null;
let dilemmaGender = null;

async function loadDilemma(kind) {
  dilemmaKind = kind || dilemmaKind || "death";
  const meta = DILEMMAS[dilemmaKind];
  show("dilemma");
  $("#dilemma-title").textContent = meta.title;
  $("#dilemma-sub").textContent = meta.sub;
  await nextDilemma();
}

async function nextDilemma() {
  const wrap = $("#dilemma-play");
  const q = `?kind=${dilemmaKind}${dilemmaGender ? "&gender=" + dilemmaGender : ""}`;
  const { status, body } = await api("/api/dilemma" + q);
  if (status >= 400) {
    versusKeys = null;
    wrap.innerHTML = `<p class="empty">Not enough approved photos for that filter yet.</p>` + dilemmaFoot();
    return wireDilemmaFoot();
  }
  let locked = false;
  const answer = async (payload) => {
    if (locked) return;
    locked = true;
    const r = await post("/api/dilemma", { kind: dilemmaKind, ...payload });
    if (r.body?.creditEarned) toast("✦ +1 credit");
    if (r.body?.credits != null) { setCredits(r.body.credits); if (me.profile) me.profile.credits = r.body.credits; }
    setTimeout(nextDilemma, 300);
  };

  if (dilemmaKind === "cheat") {
    versusKeys = null;
    wrap.innerHTML = `<div class="cheat-round">
        <div class="cheat-photo">${avatar(body.a)}${reportFlag(body.a.id)}</div>
        <div class="cheat-actions">
          <button class="primary" data-cheat="yes">Yes</button>
          <button class="outline" data-cheat="no">No</button>
        </div>
      </div>` + dilemmaFoot();
    wrap.querySelectorAll("[data-cheat]").forEach((el) =>
      el.addEventListener("click", () => answer({ aId: body.a.id, pick: el.dataset.cheat })));
  } else {
    wrap.innerHTML = `<div class="versus">
        ${withFlag(`<button class="vs-card" type="button" data-pick="a"><span class="vs-photo">${avatar(body.a)}${body.a.age ? `<span class="vs-name">${body.a.age}</span>` : ""}</span><span class="pick-hint">save, or <b>←</b></span></button>`, body.a.id)}
        <div class="acc-badge death"><b>SAVE</b><span>ONE</span></div>
        ${withFlag(`<button class="vs-card" type="button" data-pick="b"><span class="vs-photo">${avatar(body.b)}${body.b.age ? `<span class="vs-name">${body.b.age}</span>` : ""}</span><span class="pick-hint">save, or <b>→</b></span></button>`, body.b.id)}
      </div>` + dilemmaFoot();
    const choose = (pick) => answer({ aId: body.a.id, bId: body.b.id, pick });
    wrap.querySelectorAll("[data-pick]").forEach((el) => el.addEventListener("click", () => choose(el.dataset.pick)));
    versusKeys = choose; // ←/→ keys
  }
  wireDilemmaFoot();
}

const dilemmaFoot = () => `<div class="versus-foot">
    <span class="voting-on">voting on: <a data-dg="man" class="${dilemmaGender === "man" ? "on" : ""}">men</a> <a data-dg="woman" class="${dilemmaGender === "woman" ? "on" : ""}">women</a></span>
  </div>
  <div class="games-nav">dilemmas: ${Object.entries(DILEMMAS).map(([k, d]) =>
    `<a class="${k === dilemmaKind ? "on" : ""}" data-dilemma-go="${k}">${esc(d.title.toLowerCase())}</a>`).join(" · ")} · <a data-dilemma-go="home">home</a></div>`;

function wireDilemmaFoot() {
  const wrap = $("#dilemma-play");
  wrap.querySelectorAll("[data-dg]").forEach((el) => el.addEventListener("click", () => {
    dilemmaGender = dilemmaGender === el.dataset.dg ? null : el.dataset.dg;
    nextDilemma();
  }));
  wrap.querySelectorAll("[data-dilemma-go]").forEach((el) => el.addEventListener("click", () => {
    const k = el.dataset.dilemmaGo;
    if (k === "home") { versusKeys = null; return show("home"); }
    loadDilemma(k);
  }));
}

// ================= The morality quiz =================
// Reuses the same question renderer as the taste quiz. The difference is that
// every answer posts immediately and comes back with the confession stat —
// what everyone else said — which is the reason anyone finishes it.
let MORAL_META = { minAnswered: 24, total: 36 };

async function loadMoralQuiz() {
  const { status, body } = await api("/api/moral-questions");
  if (status !== 200 || !body) return;
  MORAL_META = { minAnswered: body.minAnswered, total: body.questions.length };
  const answers = body.answers || {};
  let lastVice = null;
  $("#moral-questions").innerHTML = body.questions.map((q, n) => {
    const header = q.vice !== lastVice
      ? `<div class="quiz-head">${esc(body.vices[q.vice].emoji)} ${esc(body.vices[q.vice].label)} <span class="hint">quiz</span></div>` : "";
    lastVice = q.vice;
    return `${header}<div class="q moral-q" data-qid="${q.id}"${answers[q.id] != null ? ` data-answer="${answers[q.id]}"` : ""}>
      <p><span class="q-num">${n + 1}.</span> ${esc(q.prompt)}</p>
      ${questionBodyHTML(q)}
      <div class="confession" hidden></div></div>`;
  }).join("");

  $("#moral-questions").querySelectorAll(".moral-q").forEach((qEl) => {
    const q = body.questions.find((x) => x.id === qEl.dataset.qid);
    // Restore a previous answer's selected state.
    const prev = answers[q.id];
    if (prev != null) qEl.querySelector(`.opt[data-i="${prev}"]`)?.classList.add("sel");
    wireQuestion(qEl, q, async (i) => {
      const r = await post("/api/moral-answer", { qid: q.id, i });
      if (r.status !== 200) return;
      showConfession(qEl, r.body.stats, q);
      updateMoralProgress(r.body.answered, r.body.total, r.body.score);
    });
  });
  updateMoralProgress(body.answered, body.questions.length, me?.profile?.natureScore ?? 0);
}

// "61% of people gave the same answer" — shown the moment you commit to one.
function showConfession(qEl, stats, q) {
  const el = qEl.querySelector(".confession");
  if (!el || !stats) return;
  const bars = stats.shares.map((sh, i) => `<div class="cf-row${i === Number(qEl.dataset.answer) ? " mine" : ""}">
      <span class="cf-label">${esc(sh.label)}</span>
      <span class="cf-bar"><i style="width:${sh.pct ?? 0}%"></i></span>
      <span class="cf-pct">${sh.pct == null ? "—" : sh.pct + "%"}</span>
    </div>`).join("");
  const worse = stats.you?.worsePct != null && stats.total >= 5
    ? `<div class="cf-verdict">${stats.you.worsePct}% of people answered worse than you did.</div>` : "";
  el.innerHTML = `<b>${esc(stats.you?.line || "")}</b>${bars}${worse}
    <div class="meta">${stats.total.toLocaleString()} answers</div>`;
  el.hidden = false;
}

function updateMoralProgress(answered, total, score) {
  const pct = Math.round((answered / total) * 100);
  $("#moral-bar").style.width = pct + "%";
  $("#moral-count").textContent = `${answered} / ${total}`;
  if (me?.profile) { me.profile.moralAnswered = answered; me.profile.natureScore = score; }
  const left = MORAL_META.minAnswered - answered;
  $("#moral-verdict").innerHTML = answered >= MORAL_META.minAnswered
    ? `<div class="card"><b>Score: ${score > 0 ? "+" : ""}${score}</b>
         <div class="meta">Enough answered to match. Finish the rest to sharpen it — see the full verdict on your report.</div>
         <button class="outline" style="margin-top:8px" data-view="report">open your report →</button></div>`
    : `<div class="card"><b>${left} more before you can match</b>
         <div class="meta">Your Human Nature score gates who you're allowed to match with. Until you've answered ${MORAL_META.minAnswered}, nobody can match you.</div></div>`;
  $("#moral-verdict").querySelector("[data-view]")?.addEventListener("click", () => show("report"));
  renderMoralNag();
}

// Home tile nag: the quiz is the thing blocking matches, so say so.
function renderMoralNag() {
  const answered = me?.profile?.moralAnswered || 0;
  const done = answered >= MORAL_META.minAnswered;
  const badge = $("#moral-badge");
  const meta = $("#moral-meta");
  if (badge) badge.hidden = done;
  if (meta) meta.textContent = done ? `${answered} / ${MORAL_META.total} answered →` : "required to match →";
}

// ================= Reporting =================
// Available on every photo, and deliberately usable by anyone who can see one.
let REPORT_REASONS = [];
let reportTarget = null;

async function openReport(targetId) {
  reportTarget = targetId;
  if (!REPORT_REASONS.length) REPORT_REASONS = (await api("/api/report-reasons")).body?.reasons || [];
  let chosen = null;
  $("#report-reasons").innerHTML = REPORT_REASONS.map((r) =>
    `<span class="opt" data-reason="${r.key}">${esc(r.label)}${r.urgent ? `<b class="urgent">photo comes down straight away</b>` : ""}</span>`).join("");
  $("#report-result").hidden = true;
  $("#report-detail").value = "";
  $("#report-send").disabled = true;
  $("#report-modal").hidden = false;

  $("#report-reasons").querySelectorAll("[data-reason]").forEach((el) => el.addEventListener("click", () => {
    $("#report-reasons").querySelectorAll(".opt").forEach((o) => o.classList.remove("sel"));
    el.classList.add("sel");
    chosen = el.dataset.reason;
    $("#report-send").disabled = false;
  }));
  $("#report-close").onclick = () => { $("#report-modal").hidden = true; };
  $("#report-send").onclick = async () => {
    if (!chosen) return;
    $("#report-send").disabled = true;
    const r = await post("/api/report", {
      targetId: reportTarget, reason: chosen,
      detail: $("#report-detail").value, contact: $("#report-contact").value,
    });
    const out = $("#report-result");
    out.hidden = false;
    out.className = "report-result " + (r.status === 201 ? "ok" : "no");
    out.textContent = r.status === 201
      ? (r.body.hidden
          ? `Reported. The photo is hidden from everyone while we look at it. ${r.body.response}`
          : `Reported. ${r.body.response}`)
      : "Couldn't send that report.";
    if (r.status === 201) setTimeout(() => { $("#report-modal").hidden = true; }, 3200);
  };
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-report]");
  if (el) { e.preventDefault(); e.stopPropagation(); openReport(el.dataset.report); }
});

// A small flag on any photo card. Kept understated so it doesn't invite misuse,
// but present everywhere a face is shown.
const reportFlag = (id) => `<button class="report-flag" data-report="${id}" title="Report this photo" aria-label="Report this photo">⚑</button>`;
// Wraps a photo card so the flag can sit over it as a sibling — a button
// nested inside a button is invalid and gets pulled apart by the parser.
const withFlag = (cardHtml, id) => `<span class="vs-slot">${cardHtml}${reportFlag(id)}</span>`;

// ================= Photo moderation (owner-facing) =================
const PHOTO_STATUS = {
  pending: { cls: "pending", icon: "⏳", title: "Photo pending review",
    body: "Nobody sees your photo until a human approves it. Everything else on the site works in the meantime." },
  rejected: { cls: "rejected", icon: "⛔", title: "Photo rejected",
    body: "Your photo isn't shown to anyone. Upload a different one that meets the requirements above." },
  approved: { cls: "approved", icon: "✅", title: "Photo approved",
    body: "You're in the rating pool — strangers are comparing your photo right now." },
};
function renderPhotoStatus() {
  const el = $("#photo-status");
  const p = me?.profile;
  if (!el) return;
  if (!p) { el.hidden = true; return; }
  const s = PHOTO_STATUS[p.photoStatus] || PHOTO_STATUS.pending;
  const reason = p.moderation?.reason ? `<div class="meta">reason: ${esc(p.moderation.reason)}</div>` : "";
  const locked = p.accountLocked
    ? `<div class="meta"><b>This account is locked.</b> Re-uploading is disabled — contact support if you think this is a mistake.</div>`
    : "";
  el.className = `photo-status ${s.cls}`;
  el.innerHTML = `<b>${s.icon} ${s.title}</b><div class="meta">${s.body}</div>${reason}${locked}`;
  el.hidden = false;
  if (!p.hasPhoto && p.photoStatus !== "rejected") {
    el.className = "photo-status pending";
    el.innerHTML = `<b>📸 No photo yet</b><div class="meta">Add one below — without a photo you can't be rated, and you can't match.</div>`;
    el.hidden = false;
  }
  // A reviewer asked for ID: surface the upload card and say why.
  if (p.idRequested) {
    $("#id-card").hidden = false;
    el.className = "photo-status pending";
    el.innerHTML = `<b>🪪 Age check requested</b>
      <div class="meta">A reviewer wasn't certain about your age, so your photo is on hold. Send a photo of yourself holding your ID next to your face using the card below — we delete it as soon as we've decided.</div>`;
    el.hidden = false;
    return;
  }
  $("#id-card").hidden = true;

  // Voters have no photo and nothing pending — say so rather than nagging.
  if (!p.hasPhoto) {
    el.className = "photo-status";
    el.innerHTML = `<b>You're a voter.</b>
      <div class="meta">You can rate everyone and see your own report. Add a photo below if you want to be rated too — it goes to a human reviewer first, and you'll get a rank on the Top 10.</div>`;
    el.hidden = false;
    return;
  }

  if (p.verificationRequired && !p.verified) {
    el.className = "photo-status pending";
    el.innerHTML = `<b>🪪 Age verification needed</b>
      <div class="meta">Your photo can't go live until we've confirmed you're 18 or over. We never see or keep your ID — our verification partner checks it and tells us pass or fail, nothing else.</div>
      <button class="primary" id="start-verify" style="margin-top:10px">Verify my age</button>`;
    el.hidden = false;
    el.querySelector("#start-verify").onclick = async () => {
      const r = await post("/api/verify/start", {});
      if (r.status === 503) return toast(r.body?.error || "Verification isn't available yet.");
      if (r.body?.url) location.href = r.body.url;
    };
    return;
  }
  const meta = $("#photo-meta");
  if (meta) meta.textContent = { pending: "pending review →", rejected: "rejected — fix it →", approved: "manage →" }[p.photoStatus] || "manage →";
}

// ================= Admin: reports =================
async function loadAdminReports() {
  const wrap = $("#admin-reports");
  // The labels live with the reasons; without this the queue shows raw keys
  // ("minor") to the one person who most needs to read the sentence.
  if (!REPORT_REASONS.length) REPORT_REASONS = (await api("/api/report-reasons")).body?.reasons || [];
  const { status, body } = await api("/api/admin/reports");
  if (status !== 200) return (wrap.innerHTML = `<p class="empty">Admin access required.</p>`);

  const badge = $("#report-badge");
  badge.textContent = body.open.length;
  badge.hidden = body.open.length === 0;

  // The number that says whether you're actually meeting the response windows
  // the Terms commit to. If this goes red, the document is writing cheques the
  // operation isn't cashing.
  const age = body.oldestOpenHours;
  const sla = age == null ? "" :
    `<div class="card ${age > 24 ? "sla-late" : "sla-ok"}"><b>Oldest open report: ${age}h</b>
      <div class="meta">${age > 24
        ? "Past the 24-hour window the Terms promise for urgent reports."
        : "Inside the published response windows."}</div></div>`;

  wrap.innerHTML = sla + `<div class="section-title">Open reports (${body.open.length})</div>` +
    (body.open.length ? body.open.map((r) => `
      <div class="card review-card" data-report-id="${r.id}">
        ${r.target ? avatar(r.target, "review-photo") : ""}
        <div class="review-body">
          <h3>${r.urgent ? "🚨 " : ""}${esc(REPORT_LABEL(r.reason))}</h3>
          <div class="meta">${new Date(r.createdAt).toLocaleString()}${r.urgent ? " · photo already hidden" : ""}</div>
          ${r.target ? `<div class="meta">${esc(r.target.name)}${r.target.age ? ", " + r.target.age : ""} · ${esc(r.target.photoStatus)}</div>` : `<div class="meta">profile deleted</div>`}
          ${r.detail ? `<blockquote class="report-detail">${esc(r.detail)}</blockquote>` : ""}
          ${r.contact ? `<div class="meta">reporter: ${esc(r.contact)}</div>` : ""}
          <div class="review-actions">
            <button class="danger" data-res="actioned">Actioned</button>
            <button class="outline" data-res="dismissed">Dismiss</button>
            ${r.target ? `<button class="outline" data-goto-photo="${r.target.id}">open photo review</button>` : ""}
          </div>
        </div>
      </div>`).join("") : `<p class="empty">Nothing open. 🎉</p>`);

  wrap.querySelectorAll("[data-res]").forEach((btn) => btn.addEventListener("click", async () => {
    const id = btn.closest("[data-report-id]").dataset.reportId;
    const resolution = prompt(btn.dataset.res === "actioned" ? "What did you do?" : "Why dismiss it?");
    if (resolution === null) return;
    await post(`/api/admin/reports/${id}`, { status: btn.dataset.res, resolution });
    loadAdminReports();
  }));
  wrap.querySelectorAll("[data-goto-photo]").forEach((b) => b.addEventListener("click", () => showAdminTab("queue")));
}
const REPORT_LABEL = (key) => (REPORT_REASONS.find((r) => r.key === key)?.label) || key;

function showAdminTab(tab) {
  $("#admin-reports").hidden = tab !== "reports";
  $("#admin-queue").hidden = tab !== "queue";
  $("#admin-queue-title").hidden = tab !== "queue";
  $("#admin-queue-sub").hidden = tab !== "queue";
  document.querySelectorAll("[data-admin]").forEach((b) => b.classList.toggle("active", b.dataset.admin === tab));
  if (tab === "reports") loadAdminReports(); else loadAdminQueue();
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-admin]");
  if (el) showAdminTab(el.dataset.admin);
});

// ================= Admin: photo approval queue =================
async function loadAdminQueue() {
  const wrap = $("#admin-queue");
  const { status, body } = await api("/api/admin/queue");
  if (status !== 200) return (wrap.innerHTML = `<p class="empty">Admin access required.</p>`);
  const card = (u, decided) => `<div class="card review-card" data-id="${u.id}">
    ${avatar(u, "review-photo")}
    <div class="review-body">
      <h3>${esc(u.name)}${u.age ? ", " + u.age : " — no age given"}</h3>
      <div class="meta">${esc(u.genderIdentity || u.gender || "gender not given")} · submitted ${new Date(u.photoSubmittedAt).toLocaleString()}</div>
      ${(u.moderation.flags || []).length ? `<div class="flags">${u.moderation.flags.map((f) => `<span class="flag">${esc(f)}</span>`).join("")}</div>` : `<div class="meta">no automated flags</div>`}
      <div class="meta">${u.verified ? `✅ age verified (${esc(u.verificationMethod || "?")})` : u.idRequested ? "🪪 ID requested — waiting on them" : "not age-checked"}</div>
      ${u.hasId ? `<div class="id-review">
          <b>ID submitted</b>
          <img src="/api/admin/id/${u.id}" alt="submitted ID" />
          <div class="meta">Deleted the moment you decide.</div>
        </div>` : ""}
      ${u.moderation.reason ? `<div class="meta">reason: ${esc(u.moderation.reason)}</div>` : ""}
      ${decided
        ? `<div class="meta">${esc(u.photoStatus)}${u.accountLocked ? " · account locked" : ""} by ${esc(u.moderation.reviewedBy || "admin")}</div>`
        : `<div class="review-actions">
             <button class="primary" data-act="approve">Approve</button>
             <button class="outline" data-act="reject">Reject</button>
             <button class="danger" data-act="escalate">Escalate &amp; lock</button>
             ${u.hasId || u.idRequested ? "" : `<button class="outline" data-act="request-id">Request ID</button>`}
             <button class="outline" data-verify="${u.verified ? "off" : "on"}">${u.verified ? "Un-verify" : "Mark age verified"}</button>
           </div>`}
    </div></div>`;
  wrap.innerHTML = `
    <div class="section-title">Awaiting review (${body.pending.length})</div>
    ${body.pending.length ? body.pending.map((u) => card(u, false)).join("") : `<p class="empty">Nothing waiting. 🎉</p>`}
    <div class="section-title">Recent decisions</div>
    ${body.decided.length ? body.decided.slice(0, 20).map((u) => card(u, true)).join("") : `<p class="empty">No decisions yet.</p>`}`;
  wrap.querySelectorAll("[data-act]").forEach((btn) => btn.addEventListener("click", async () => {
    const id = btn.closest(".review-card").dataset.id;
    const action = btn.dataset.act;
    let reason = null;
    if (action === "reject" || action === "escalate") {
      reason = prompt(action === "escalate" ? "Why is this being escalated? (e.g. possible minor)" : "Why is this photo rejected?");
      if (reason === null) return;
    }
    if (action === "request-id" && !confirm("Ask this person for a photo holding their ID? Their photo stays hidden until they send it.")) return;
    const r = await post(`/api/admin/photo/${id}`, { action, reason });
    if (r.status !== 200) return toast(r.body?.error || "Couldn't save that decision.");
    toast(`${esc(action)}d`);
    loadAdminQueue();
  }));
  wrap.querySelectorAll("[data-verify]").forEach((btn) => btn.addEventListener("click", async () => {
    const id = btn.closest(".review-card").dataset.id;
    await post(`/api/admin/verify/${id}`, { verified: btn.dataset.verify === "on" });
    loadAdminQueue();
  }));
}

// Linked socials, shown on participant cards and the Top 10 — never in the
// rating pool, where a handle under a face would change the vote.
const SOCIAL_URL = {
  instagram: (h) => `https://instagram.com/${h}`,
  tiktok: (h) => `https://tiktok.com/@${h}`,
  twitter: (h) => `https://x.com/${h}`,
  snapchat: (h) => `https://snapchat.com/add/${h}`,
};
function socialLinks(s) {
  const items = Object.entries(s || {})
    .filter(([k, v]) => v && SOCIAL_URL[k])
    .map(([k, v]) => `<a class="pill" href="${esc(SOCIAL_URL[k](encodeURIComponent(v)))}" target="_blank" rel="noopener noreferrer">${esc(k)}: @${esc(v)}</a>`);
  return items.length ? `<span class="socials">${items.join("")}</span>` : "";
}

// ================= Guessing game play =================
const gamesFooter = (activeKey) =>
  `<div class="games-nav">games: ${(META.games || []).map((g) =>
    `<a class="${g.key === activeKey ? "on" : ""}" data-goto="${g.key}">${esc(g.label.toLowerCase())}</a>`).join(" · ")} · <a data-goto="home">home</a></div>`;

async function playGame(gameKey) {
  show("games");
  const game = (META.games || []).find((g) => g.key === gameKey);
  if (!game) return;
  const cfg = META.game || { rounds: 5, need: 3, reward: 2 };
  $("#game-title").textContent = game.title;
  const wrap = $("#game-play");

  const wireFooter = () => wrap.querySelectorAll("[data-goto]").forEach((a) =>
    a.addEventListener("click", () => a.dataset.goto === "home" ? (renderGameGrid(), show("home")) : playGame(a.dataset.goto)));

  // ---- Step 1: the same question about you ----
  const { q: selfQ, bank } = selfQuestion(game);
  if (!selfQ) return runRounds(); // no self-question available — go straight to the rounds
  wrap.innerHTML = `<p class="game-sub">For every ${cfg.need}/${cfg.rounds} correct, earn ${cfg.reward} credits.</p>
    <div class="card"><h3>First, the same question about you</h3>
      <p class="sub">Fair's fair: before guessing about others, your own answer goes in the pot. It stays private and is only used in aggregate.</p>
      <div class="q" data-qid="${selfQ.id}"><p>${esc(selfQ.prompt)}</p>${questionBodyHTML(selfQ)}
        <div class="confession" hidden></div></div>
    </div>${gamesFooter(game.key)}`;
  wireFooter();
  const qEl = wrap.querySelector(".q");
  wireQuestion(qEl, selfQ, async (i) => {
    // A morality answer goes through the quiz endpoint so it scores and returns
    // the confession stat; a taste answer just updates the trait vector.
    if (bank === "moral") {
      const r = await post("/api/moral-answer", { qid: selfQ.id, i });
      if (r.status === 200) {
        showConfession(qEl, r.body.stats, selfQ);
        if (me.profile) { me.profile.natureScore = r.body.score; me.profile.moralAnswered = r.body.answered; }
        renderMoralNag();
        return setTimeout(runRounds, 2200); // long enough to read the stat
      }
    } else {
      await post("/api/answer", { qid: selfQ.id, i });
    }
    setTimeout(runRounds, 350); // brief beat so the selection registers visually
  });

  // ---- Step 2: two-photo comparison rounds ("who is more X") ----
  let gameGender = null; // null = everyone; "man" | "woman"
  async function runRounds() {
    const stats = (await api("/api/guess-stats")).body || {};
    const base = { correct: stats[game.axis]?.correct || 0, total: stats[game.axis]?.total || 0 };
    let round = 0, correct = 0, sessionVotes = 0, sessionCorrect = 0, locked = false;
    let a, b;

    const acc = () => {
      const t = base.total + sessionVotes;
      return t ? Math.round(((base.correct + sessionCorrect) / t) * 100) : null;
    };
    const render = () => {
      const av = acc();
      wrap.innerHTML = `<p class="game-sub">For every ${cfg.need}/${cfg.rounds} correct, earn ${cfg.reward} credits.</p>
        <div class="versus">
          ${withFlag(`<button class="vs-card" type="button" data-pick="a"><span class="vs-photo">${avatar(a)}${a.age ? `<span class="vs-name">${a.age}</span>` : ""}</span><span class="pick-hint">click, or <b>←</b></span></button>`, a.id)}
          <div class="acc-badge"><b>${av == null ? "—" : av + "%"}</b><span>ACCURACY</span><small>${base.total + sessionVotes} pairs</small></div>
          ${withFlag(`<button class="vs-card" type="button" data-pick="b"><span class="vs-photo">${avatar(b)}${b.age ? `<span class="vs-name">${b.age}</span>` : ""}</span><span class="pick-hint">click, or <b>→</b></span></button>`, b.id)}
        </div>
        <div class="versus-foot">
          <span>${sessionVotes} this session · ${base.total + sessionVotes} all time</span>
          <span class="voting-on">voting on: <a data-vg="man" class="${gameGender === "man" ? "on" : ""}">men</a> <a data-vg="woman" class="${gameGender === "woman" ? "on" : ""}">women</a></span>
        </div>
        <div class="result" id="game-result"></div>
        <p class="game-sub" style="text-align:center">Round ${Math.min(round + 1, cfg.rounds)} of ${cfg.rounds} · ${correct} correct</p>
        ${gamesFooter(game.key)}`;
      wireFooter();
      wrap.querySelectorAll("[data-vg]").forEach((el) => el.addEventListener("click", () => {
        gameGender = gameGender === el.dataset.vg ? null : el.dataset.vg;
        loadPair();
      }));
      wrap.querySelectorAll("[data-pick]").forEach((el) => el.addEventListener("click", () => choose(el.dataset.pick)));
      versusKeys = choose;
    };
    const loadPair = async () => {
      const { status, body } = await api(`/api/versus?axis=${game.axis}${gameGender ? "&gender=" + gameGender : ""}`);
      if (status >= 400) { versusKeys = null; wrap.innerHTML = `<p class="empty">Not enough profiles for that filter.</p>${gamesFooter(game.key)}`; wireFooter(); return; }
      a = body.a; b = body.b; render();
    };
    const choose = async (pick) => {
      if (locked || !a || !b) return;
      locked = true;
      wrap.querySelector(`[data-pick="${pick}"]`)?.classList.add("sel");
      const { body: out } = await post("/api/versus-guess", { axis: game.axis, aId: a.id, bId: b.id, pick });
      sessionVotes++; round++;
      if (out.correct) { correct++; sessionCorrect++; }
      const res = $("#game-result");
      res.className = "result " + (out.correct ? "ok" : "no");
      res.textContent = out.correct ? "Correct!" : "Nope";
      setTimeout(async () => { locked = false; if (round >= cfg.rounds) return finish(); await loadPair(); }, 850);
    };
    const finish = async () => {
      versusKeys = null;
      const { body: rew } = await post("/api/games/reward", { correct });
      if (rew?.credits != null) { setCredits(rew.credits); me.profile.credits = rew.credits; }
      wrap.innerHTML = `<div class="card" style="text-align:center">
        <h3>${correct}/${cfg.rounds} correct${rew?.earned ? ` — +${rew.reward} credits ✦` : ""}</h3>
        <p class="sub">${rew?.earned ? "Nice read." : `Get ${cfg.need}/${cfg.rounds} to earn credits.`}</p>
        <button class="primary" id="again">play again</button></div>${gamesFooter(game.key)}`;
      wireFooter();
      $("#again").addEventListener("click", () => playGame(game.key));
    };
    loadPair();
  }
}
