let me = null; // { account, profile }
let META = { guessAxes: [] };
const selectedMH = new Set();

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let photoData = null; // uploaded photo as a downscaled data: URL
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
    ? `<img class="${cls}" src="${esc(u.photoUrl)}" alt="${esc(u.name)}" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'avatar ${cls}',textContent:'${esc((u.name||'?')[0])}'}))" />`
    : `<div class="avatar ${cls}">${esc((u.name || "?")[0])}</div>`;
}
const setCredits = (n) => { if (n != null) $("#credits").textContent = n; };

// ================= Auth screen =================
let authMode = "login";
$("#tab-login").addEventListener("click", () => setAuthMode("login"));
$("#tab-signup").addEventListener("click", () => setAuthMode("signup"));
function setAuthMode(mode) {
  authMode = mode;
  $("#tab-login").classList.toggle("active", mode === "login");
  $("#tab-signup").classList.toggle("active", mode === "signup");
  $("#auth-submit").textContent = mode === "login" ? "Log in" : "Create account";
  $("#auth-form").password.autocomplete = mode === "login" ? "current-password" : "new-password";
  $("#auth-err").hidden = true;
}
$("#auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = e.target.email.value, password = e.target.password.value;
  const { status, body } = await post(`/auth/${authMode}`, { email, password });
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
  if (view === "report") loadReport();
  if (view === "matches") loadMatches();
  if (view === "buy") loadBuy();
  if (view === "admin") loadAdminQueue();
  if (view === "moral") loadMoralQuiz();
  window.scrollTo(0, 0);
}

$("#signout").addEventListener("click", async () => {
  await post("/auth/logout", {});
  location.reload();
});

// ================= Bootstrap =================
(async function start() {
  const cfg = await api("/auth/config");
  if (cfg.body?.google) $("#google-wrap").hidden = false;
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
  $("#view-landing").classList.remove("active");
  $("#app").hidden = false;
  setCredits(me.profile?.credits ?? 0);
  $("#tab-admin").hidden = !me.isAdmin;
  $("#admin-tile").hidden = !me.isAdmin;
  renderPhotoStatus();
  renderMoralNag();
  if (!me.profile) { showApp(); show("onboard"); prefillName(); }
  else { showApp(); show("home"); }
}
function showLanding() { $("#app").hidden = true; $("#view-landing").classList.add("active"); }
function showApp() { $("#view-landing").classList.remove("active"); $("#app").hidden = false; }
function prefillName() {
  const email = me.account?.email || "";
  $("#onboard-form").name.value = email.split("@")[0] || "";
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
    age: f.age.value, gender, genderIdentity, orientation: f.orientation.value, ratingsFrom,
    prediction: predMoved ? f.prediction.value : null,
    mentalHealth: [...selectedMH], socials: { instagram: f.instagram.value },
    confirmedAdult: [...$("#confirms").querySelectorAll("[data-confirm]")].every((c) => c.checked),
  };
  const photo = photoData || f.photo.value;
  if (photo) payload.photo = photo; // keep existing photo when editing without a new one
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
  setCredits(body.credits);
  renderPhotoStatus();
  show("home");
  if (body.photoStatus === "pending") toast("⏳ Photo submitted — it goes live once a human approves it.");
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

  const matches = (await api("/api/matches")).body || [];
  const badge = $("#match-badge");
  badge.textContent = matches.length; badge.hidden = matches.length === 0;

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
  $("#matchup").innerHTML = [body.a, body.b].map((u, i) => `<button class="vs-card pick" type="button"
      data-win="${u.id}" data-lose="${u.id === body.a.id ? body.b.id : body.a.id}">
      <span class="vs-photo">${avatar(u)}<span class="vs-name">${esc(u.name)}${u.age ? ", " + u.age : ""}</span></span>
      <span class="pick-hint">click, or <b>${i === 0 ? "←" : "→"}</b></span></button>`).join("")
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
    else if (g.ready) right = `<button class="reveal-btn" data-reveal="${g.key}">reveal · ${r.cost.reveal}✦</button>`;
    else right = `<button class="reveal-btn collecting" data-play-game="${g.key}">still collecting · play →</button>`;
    return `<div class="guess-row"><span class="g-name">${g.emoji || ""} ${esc(g.label)}</span>${right}</div>`;
  }).join("");
  const guesses = `<div class="card"><div class="section-title" style="margin-top:0">🔮 What strangers guess about your photo</div>
    ${guessRows}<p class="meta" style="margin:12px 0 0">From direct guesses in the games. The more you <b>play &amp; rate</b>, the more your photo is shown to others.</p></div>`;

  // Human Nature score — the number that decides who you can match with.
  const nature = natureCard(r);

  // Who Likes You?
  const fans = r.fans.unlocked ? fansCard(r.fans.report) : lockedFansCard(r.fans, r.credits);

  // Your type + matches
  const extra = `<div class="section-title">Your type <span class="hint">— learned from the photos you chose</span></div>
    <div class="card"><p style="margin:0;font-size:17px">${esc(r.yourType.text)}</p></div>
    <div class="cards">
      <div class="card"><div class="stat"><b>${r.matches.length}</b><span class="meta">mutual matches</span></div><button class="outline" style="width:100%;margin-top:8px" id="go-matches">open matches →</button></div>
      <div class="card"><div class="stat"><b>${r.crushes}</b><span class="meta">you rated highly, no match back</span></div></div>
    </div>
    ${almostSection(r.almost || [])}
    <label class="email-pref" style="margin-top:14px"><input type="checkbox" id="email-pref" ${r.emailOnNewData ? "checked" : ""}/> email me when new data is available</label>`;

  $("#report").innerHTML = trueNatureCard(r, p) + attract + nature + tasteSection(r.taste) + guesses + fans + extra;

  $("#tn-share")?.addEventListener("click", () => shareTrueNature(r));
  $("#go-matches")?.addEventListener("click", () => show("matches"));
  $("#go-moral")?.addEventListener("click", () => show("moral"));
  $("#buy-pairs")?.addEventListener("click", () => spendAction("/api/buy-pairs", {}));
  $("#report").querySelectorAll("[data-reveal]").forEach((b) => b.addEventListener("click", () => spendAction("/api/reveal", { game: b.dataset.reveal })));
  $("#report").querySelectorAll("[data-play-game]").forEach((b) => b.addEventListener("click", () => playGame(b.dataset.playGame)));
  $("#unlock-fans")?.addEventListener("click", () => spendAction("/api/unlock-fans", {}));
  $("#email-pref")?.addEventListener("change", (e) => post("/api/email-pref", { on: e.target.checked }));
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
function almostSection(almost) {
  if (!almost.length) return "";
  const rows = almost.map((m) => {
    const why = m.blockedBy === "nature"
      ? `your Human Nature scores are ${m.natureGap} apart — too far to match`
      : m.blockedBy === "your-quiz" ? "you haven't finished the morality quiz — they're waiting on you"
      : m.blockedBy === "their-quiz" ? "they haven't taken the morality quiz yet"
      : `pick them ${m.picksToGo} more time${m.picksToGo === 1 ? "" : "s"} to unlock it`;
    return `<div class="card match-card">${avatar(m)}
      <h3>${esc(m.name)}</h3><div class="meta">${why}</div></div>`;
  }).join("");
  return `<div class="section-title">So close <span class="hint">— you both picked each other, but a gate isn't cleared</span></div>
    <div class="cards">${rows}</div>`;
}

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
    <div class="earn-line">${credits}✦ of ${f.cost}✦ earned — <b>rate photos</b> or <b>play rounds</b> to unlock it. Updates live as votes arrive.</div>
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
async function spendAction(url, body) {
  const { status, body: res } = await post(url, body);
  if (status === 402) { alert("Not enough credits — rate more photos or play games to earn them."); return; }
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
  const meta = $("#photo-meta");
  if (meta) meta.textContent = { pending: "pending review →", rejected: "rejected — fix it →", approved: "manage →" }[p.photoStatus] || "manage →";
}

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
      ${u.moderation.reason ? `<div class="meta">reason: ${esc(u.moderation.reason)}</div>` : ""}
      ${decided
        ? `<div class="meta">${esc(u.photoStatus)}${u.accountLocked ? " · account locked" : ""} by ${esc(u.moderation.reviewedBy || "admin")}</div>`
        : `<div class="review-actions">
             <button class="primary" data-act="approve">Approve</button>
             <button class="outline" data-act="reject">Reject</button>
             <button class="danger" data-act="escalate">Escalate &amp; lock</button>
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
    if (action !== "approve") {
      reason = prompt(action === "escalate" ? "Why is this being escalated? (e.g. possible minor)" : "Why is this photo rejected?");
      if (reason === null) return;
    }
    const r = await post(`/api/admin/photo/${id}`, { action, reason });
    if (r.status !== 200) return toast("Couldn't save that decision.");
    toast(`${esc(action)}d`);
    loadAdminQueue();
  }));
}

async function loadMatches() {
  const matches = (await api("/api/matches")).body || [];
  $("#matches-list").innerHTML = matches.length
    ? matches.map((m) => `<div class="card match-card">${avatar(m.user)}
        <h3>${esc(m.user.name)}${m.user.age ? ", " + m.user.age : ""}</h3>
        <div class="meta">you picked them ${m.youPickRate}% · they picked you ${m.theyPickRate}%</div>
        <div class="meta">${m.yourPicks}× / ${m.theirPicks}× picked · nature gap ${m.natureGap}</div>
        ${socialLinks(m.user.socials)}</div>`).join("")
    : `<p class="empty">No matches yet. A match takes four things: you both take the morality quiz, you pick each other over other people, at least ${META.match?.minPicks ?? 3} times each, and your Human Nature scores land within ${META.match?.natureWindow ?? 25} points.</p>`;
}
function socialLinks(s) {
  const items = Object.entries(s || {}).map(([k, v]) => `<a class="pill" href="https://instagram.com/${esc(v)}" target="_blank" rel="noopener">${esc(k)}: @${esc(v)}</a>`);
  return items.length ? `<div style="margin-top:8px">${items.join("")}</div>` : `<div class="meta" style="margin-top:8px">no socials shared</div>`;
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
          <button class="vs-card" type="button" data-pick="a"><span class="vs-photo">${avatar(a)}<span class="vs-name">${esc(a.name)}</span></span><span class="pick-hint">click, or <b>←</b></span></button>
          <div class="acc-badge"><b>${av == null ? "—" : av + "%"}</b><span>ACCURACY</span><small>${base.total + sessionVotes} pairs</small></div>
          <button class="vs-card" type="button" data-pick="b"><span class="vs-photo">${avatar(b)}<span class="vs-name">${esc(b.name)}</span></span><span class="pick-hint">click, or <b>→</b></span></button>
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
