let me = null; // { account, profile }
let META = { guessAxes: [] };
const selectedMH = new Set();

const $ = (s) => document.querySelector(s);
const api = (url, opts) => fetch(url, opts).then(async (r) => ({ status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }));
const post = (url, body) => api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function avatar(u, cls = "") {
  return u.photo
    ? `<img class="${cls}" src="${esc(u.photo)}" alt="${esc(u.name)}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'avatar ${cls}',textContent:'${esc((u.name||'?')[0])}'}))" />`
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
  document.querySelectorAll("#app .view").forEach((v) => v.classList.remove("active"));
  $("#view-" + view)?.classList.add("active");
  document.querySelectorAll("nav.tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  if (view === "home") loadHome();
  if (view === "report") loadReport();
  if (view === "matches") loadMatches();
  if (view === "buy") loadBuy();
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
  await buildForms();
  await boot();
})();

async function boot() {
  const { status, body } = await api("/api/me");
  if (status === 401) return showLanding();
  me = body;
  $("#view-landing").classList.remove("active");
  $("#app").hidden = false;
  setCredits(me.profile?.credits ?? 0);
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
  const { questions } = (await api("/api/questions")).body;
  let lastCat = null;
  $("#questions").innerHTML = questions.map((q, n) => {
    const header = q.category !== lastCat ? `<div class="quiz-head">${esc(q.category)} <span class="hint">quiz</span></div>` : "";
    lastCat = q.category;
    const body = q.type === "tiered"
      ? `<div class="opts tiers">${q.tierGroups.map((t, ti) => `<span class="opt tier" data-tier="${ti}">${esc(t.label)}</span>`).join("")}</div>
         <div class="opts fine" hidden></div>`
      : `<div class="opts">${q.options.map((o, i) => `<span class="opt" data-i="${i}">${esc(o.label)}</span>`).join("")}</div>`;
    return `${header}<div class="q" data-qid="${q.id}">
      <p><span class="q-num">${n + 1}.</span> ${esc(q.prompt)}</p>${body}</div>`;
  }).join("");

  // Simple questions: click sets the answer.
  $("#questions").querySelectorAll(".q > .opts:not(.tiers):not(.fine)").forEach((opts) =>
    opts.querySelectorAll(".opt").forEach((opt) => opt.addEventListener("click", () => {
      opts.querySelectorAll(".opt").forEach((o) => o.classList.remove("sel"));
      opt.classList.add("sel");
      opt.closest(".q").dataset.answer = opt.dataset.i;
    })));

  // Tiered questions: pick a range -> expand finer options -> pick the exact one.
  const qByGroups = Object.fromEntries(questions.filter((q) => q.type === "tiered").map((q) => [q.id, q.tierGroups]));
  $("#questions").querySelectorAll(".q").forEach((qEl) => {
    const tierRow = qEl.querySelector(".tiers");
    if (!tierRow) return;
    const groups = qByGroups[qEl.dataset.qid];
    const fineRow = qEl.querySelector(".fine");
    tierRow.querySelectorAll(".tier").forEach((tierEl) => tierEl.addEventListener("click", () => {
      tierRow.querySelectorAll(".tier").forEach((t) => t.classList.remove("sel"));
      tierEl.classList.add("sel");
      const g = groups[Number(tierEl.dataset.tier)];
      // render the finer options for this range
      const opts = [];
      for (let i = g.from; i < g.from + g.count; i++) opts.push(i);
      fineRow.hidden = false;
      fineRow.innerHTML = (g.count > 1 ? `<span class="fine-label">exactly how many?</span>` : "") +
        opts.map((i) => `<span class="opt" data-i="${i}">${esc(questionsFineLabel(qEl, i))}</span>`).join("");
      // auto-select if the range has a single value
      if (g.count === 1) qEl.dataset.answer = g.from;
      else delete qEl.dataset.answer;
      fineRow.querySelectorAll(".opt").forEach((opt) => opt.addEventListener("click", () => {
        fineRow.querySelectorAll(".opt").forEach((o) => o.classList.remove("sel"));
        opt.classList.add("sel");
        qEl.dataset.answer = opt.dataset.i;
      }));
    }));
  });
  // stash option labels for tiered fine rendering
  window.__tieredOpts = Object.fromEntries(questions.filter((q) => q.type === "tiered").map((q) => [q.id, q.options]));
}
function questionsFineLabel(qEl, i) {
  return (window.__tieredOpts?.[qEl.dataset.qid]?.[i]?.label) ?? String(i);
}

$("#onboard-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const answers = {};
  $("#questions").querySelectorAll(".q").forEach((q) => { if (q.dataset.answer != null) answers[q.dataset.qid] = Number(q.dataset.answer); });
  const { body } = await post("/api/profile", {
    name: f.name.value, photo: f.photo.value, age: f.age.value, gender: f.gender.value,
    orientation: f.orientation.value, mentalHealth: [...selectedMH], socials: { instagram: f.instagram.value }, answers,
  });
  me.profile = body;
  setCredits(body.credits);
  show("home");
});

// ================= Home =================
async function loadHome() {
  const p = me.profile || {};
  $("#manage-photos").innerHTML = `<h2>Manage photos</h2>
    <div style="display:flex;gap:14px;align-items:center">
      <div style="width:90px;flex:0 0 90px">${avatar(p)}</div>
      <div><div class="meta">Shown in <b>${p.matchups || 0}</b> matchups so far.</div>
      <button class="outline" style="margin-top:8px" data-view="onboard">Edit profile</button></div>
    </div>`;
  $("#manage-photos").querySelector("[data-view=onboard]").addEventListener("click", () => show("onboard"));
  const matches = (await api("/api/matches")).body || [];
  const badge = $("#match-badge");
  badge.textContent = matches.length; badge.hidden = matches.length === 0;
  // referral link
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
  const games = META.games || [];
  $("#game-grid").innerHTML = games.map((g) => {
    const acc = stats[g.axis]?.accuracy;
    return `<div class="game-cell" data-axis="${g.axis}" data-label="${esc(g.label)}"><div class="g-cat">GUESS</div><h4>${g.emoji || ""} ${esc(g.label)}</h4>
      <span class="acc">${acc == null ? "—" : acc + "%"}</span> <span class="meta">accurate · play →</span></div>`;
  }).join("");
  $("#game-grid").querySelectorAll("[data-axis]").forEach((el) => el.addEventListener("click", () => playGame(el.dataset.axis, el.dataset.label)));
}

// ================= Matchup =================
document.querySelectorAll("[data-rate]").forEach((b) => b.addEventListener("click", () => { rateGender = b.dataset.rate; show("matchup"); loadMatchup(); }));
let rateGender = null;
async function loadMatchup() {
  const { status, body } = await api(`/api/matchup${rateGender ? "?gender=" + rateGender : ""}`);
  if (status >= 400) { $("#matchup").innerHTML = ""; $("#matchup-empty").hidden = false; return; }
  $("#matchup-empty").hidden = true;
  $("#matchup").innerHTML = [body.a, body.b].map((u) => `<div class="vs-card">${avatar(u)}
      <h3>${esc(u.name)}${u.age ? ", " + u.age : ""}</h3>
      <button class="pick" data-win="${u.id}" data-lose="${u.id === body.a.id ? body.b.id : body.a.id}">choose</button></div>`).join("");
  $("#matchup").querySelectorAll(".pick").forEach((btn) => btn.addEventListener("click", async () => {
    const { body: res } = await post("/api/vote", { winnerId: btn.dataset.win, loserId: btn.dataset.lose });
    if (res?.credits != null) { setCredits(res.credits); me.profile.credits = res.credits; }
    loadMatchup();
  }));
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
    else right = `<button class="reveal-btn collecting" data-play-axis="${gameAxis(g.key)}" data-label="${esc(g.label)}">still collecting · play →</button>`;
    return `<div class="guess-row"><span class="g-name">${g.emoji || ""} ${esc(g.label)}</span>${right}</div>`;
  }).join("");
  const guesses = `<div class="card"><div class="section-title" style="margin-top:0">🔮 What strangers guess about your photo</div>
    ${guessRows}<p class="meta" style="margin:12px 0 0">From direct guesses in the games. The more you <b>play &amp; rate</b>, the more your photo is shown to others.</p></div>`;

  // Who Likes You?
  const fans = r.fans.unlocked ? fansCard(r.fans.report) : lockedFansCard(r.fans, r.credits);

  // Your type + matches
  const extra = `<div class="section-title">Your type <span class="hint">— learned from the photos you chose</span></div>
    <div class="card"><p style="margin:0;font-size:17px">${esc(r.yourType.text)}</p></div>
    <div class="cards">
      <div class="card"><div class="stat"><b>${r.matches.length}</b><span class="meta">mutual matches</span></div><button class="outline" style="width:100%;margin-top:8px" id="go-matches">open matches →</button></div>
      <div class="card"><div class="stat"><b>${r.crushes}</b><span class="meta">you rated highly, no match back</span></div></div>
    </div>
    <label class="email-pref" style="margin-top:14px"><input type="checkbox" id="email-pref" ${r.emailOnNewData ? "checked" : ""}/> email me when new data is available</label>`;

  $("#report").innerHTML = attract + guesses + fans + extra;

  $("#go-matches")?.addEventListener("click", () => show("matches"));
  $("#buy-pairs")?.addEventListener("click", () => spendAction("/api/buy-pairs", {}));
  $("#report").querySelectorAll("[data-reveal]").forEach((b) => b.addEventListener("click", () => spendAction("/api/reveal", { game: b.dataset.reveal })));
  $("#report").querySelectorAll("[data-play-axis]").forEach((b) => b.addEventListener("click", () => playGame(b.dataset.playAxis, b.dataset.label)));
  $("#unlock-fans")?.addEventListener("click", () => spendAction("/api/unlock-fans", {}));
  $("#email-pref")?.addEventListener("change", (e) => post("/api/email-pref", { on: e.target.checked }));
}
const gameAxis = (key) => (META.games.find((g) => g.key === key) || {}).axis;

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

// ================= Matches (socials only) =================
async function loadMatches() {
  const matches = (await api("/api/matches")).body || [];
  $("#matches-list").innerHTML = matches.length
    ? matches.map((m) => `<div class="card match-card">${avatar(m.user)}
        <h3>${esc(m.user.name)}${m.user.age ? ", " + m.user.age : ""}</h3>
        <div class="meta">you picked them ${m.youPickRate}% · they picked you ${m.theyPickRate}%</div>
        ${socialLinks(m.user.socials)}</div>`).join("")
    : `<p class="empty">No matches yet. Rate photos — a match happens when you both pick each other over others.</p>`;
}
function socialLinks(s) {
  const items = Object.entries(s || {}).map(([k, v]) => `<a class="pill" href="https://instagram.com/${esc(v)}" target="_blank" rel="noopener">${esc(k)}: @${esc(v)}</a>`);
  return items.length ? `<div style="margin-top:8px">${items.join("")}</div>` : `<div class="meta" style="margin-top:8px">no socials shared</div>`;
}

// ================= Guessing game play =================
async function playGame(axis, label) {
  show("games");
  const game = (META.games || []).find((g) => g.axis === axis);
  $("#game-title").textContent = `Guess: ${label || game?.label || axis}`;
  let round = 0, correct = 0;
  const prompts = {
    age: ["Older or younger than 30?", [["under 30", "under 30"], ["30+", "30+"]]],
    gender: ["What's their gender?", [["woman", "woman"], ["man", "man"], ["nonbinary", "nonbinary"]]],
    mh: ["Do they report a mental-health condition?", [["yes", "yes"], ["no", "no"]]],
  };
  if (game) prompts[axis] = [`${game.emoji} ${game.label}?`, [[game.poles[0], "low"], [game.poles[1], "high"]]];
  const finish = async () => {
    const { body: rew } = await post("/api/games/reward", { correct });
    if (rew?.credits != null) { setCredits(rew.credits); me.profile.credits = rew.credits; }
    $("#game-play").innerHTML = `<div class="card" style="text-align:center"><h3>${correct}/3 correct${rew?.earned ? " — +1 credit ✦" : ""}</h3>
      <button class="primary" id="again">play again</button> <button class="outline" data-view="home">home</button></div>`;
    $("#again").addEventListener("click", () => playGame(axis, label));
    $("#game-play").querySelector("[data-view=home]").addEventListener("click", () => { renderGameGrid(); show("home"); });
  };
  const next = async () => {
    if (round >= 3) return finish();
    round++;
    const { status, body: g } = await api(`/api/guess?axis=${axis}`);
    if (status >= 400) return ($("#game-play").innerHTML = `<p class="empty">Need more profiles to play.</p>`);
    const [prompt, opts] = prompts[axis] || [`Are they high or low on ${axis}?`, [["low", "low"], ["high", "high"]]];
    $("#game-play").innerHTML = `<div class="progress">Round ${round}/3 · ${correct} correct</div>
      <div class="game-target">${avatar(g.target)}<div class="game-q">${esc(prompt)}</div>
      <div class="game-actions">${opts.map(([label, val]) => `<button class="primary" data-g="${esc(val)}">${esc(label)}</button>`).join("")}</div></div>
      <div class="result" id="game-result"></div>`;
    $("#game-play").querySelectorAll("[data-g]").forEach((b) => b.addEventListener("click", async () => {
      $("#game-play").querySelectorAll("[data-g]").forEach((x) => (x.disabled = true));
      const { body: out } = await post("/api/guess", { targetId: g.target.id, axis, guess: b.dataset.g });
      if (out.correct) correct++;
      const res = $("#game-result");
      res.className = "result " + (out.correct ? "ok" : "no");
      res.textContent = (out.correct ? "Correct! " : "Nope — ") + "actually: " + out.actualLabel;
      setTimeout(next, 1100);
    }));
  };
  next();
}
