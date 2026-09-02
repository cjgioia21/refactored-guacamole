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
  $("#questions").innerHTML = questions.map((q) => `<div class="q" data-qid="${q.id}">
      <div class="cat">${esc(q.category)}</div><p>${esc(q.prompt)}</p>
      <div class="opts">${q.options.map((o, i) => `<span class="opt" data-i="${i}">${esc(o.label)}</span>`).join("")}</div></div>`).join("");
  $("#questions").querySelectorAll(".q").forEach((q) => q.querySelectorAll(".opt").forEach((opt) =>
    opt.addEventListener("click", () => { q.querySelectorAll(".opt").forEach((o) => o.classList.remove("sel")); opt.classList.add("sel"); q.dataset.answer = opt.dataset.i; })));
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
  renderGameGrid();
}

// ================= Game grid (with accuracy) =================
const GAME_LABELS = { age: "Age", gender: "Gender", mh: "Mental health", pol: "Politics", dom: "Dom or sub", adv: "Adventurousness", rel: "Religiosity", amb: "Ambition" };
const GAME_AXES = ["age", "gender", "mh", "pol", "dom", "adv"];
async function renderGameGrid() {
  const stats = (await api("/api/guess-stats")).body || {};
  $("#game-grid").innerHTML = GAME_AXES.map((a) => {
    const acc = stats[a]?.accuracy;
    return `<div class="game-cell" data-axis="${a}"><div class="g-cat">GUESS</div><h4>${esc(GAME_LABELS[a] || a)}</h4>
      <span class="acc">${acc == null ? "—" : acc + "%"}</span> <span class="meta">accurate · play →</span></div>`;
  }).join("");
  $("#game-grid").querySelectorAll("[data-axis]").forEach((el) => el.addEventListener("click", () => playGame(el.dataset.axis)));
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

// ================= Report =================
async function loadReport() {
  const r = (await api("/api/report")).body;
  if (!r) return ($("#report").innerHTML = `<p class="empty">Not available.</p>`);
  const traits = (arr) => arr.map((t) => `<span class="pill">${esc(t.label)}</span>`).join("") || `<span class="meta">not enough data yet</span>`;
  $("#report").innerHTML = `
    <div class="card"><div class="stat"><b>${r.attractivenessPercentile}%</b><span class="meta">more attractive than others · Elo ${r.elo} · ${r.matchups} matchups</span></div></div>
    <div class="section-title">Your type <span class="hint">— learned from the photos you chose</span></div>
    <div class="card"><p style="margin:0;font-size:17px">${esc(r.yourType.text)}</p></div>
    <div class="section-title">The type of person attracted to you</div>
    <div class="card">${traits(r.likedBy)}</div>
    <div class="section-title">Where you stand</div>
    <div class="cards">
      <div class="card"><div class="stat"><b>${r.matches.length}</b><span class="meta">mutual matches</span></div><button class="outline" style="width:100%;margin-top:8px" id="go-matches">open matches →</button></div>
      <div class="card"><div class="stat"><b>${r.crushes}</b><span class="meta">you rated highly, no match back yet</span></div></div>
    </div>`;
  $("#go-matches")?.addEventListener("click", () => show("matches"));
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
async function playGame(axis) {
  show("games");
  $("#game-title").textContent = `Guess: ${GAME_LABELS[axis] || axis}`;
  let round = 0, correct = 0;
  const prompts = {
    age: ["Older or younger than 30?", [["under 30", "under 30"], ["30+", "30+"]]],
    gender: ["What's their gender?", [["woman", "woman"], ["man", "man"], ["nonbinary", "nonbinary"]]],
    mh: ["Do they report a mental-health condition?", [["yes", "yes"], ["no", "no"]]],
  };
  const finish = async () => {
    const { body: rew } = await post("/api/games/reward", { correct });
    if (rew?.credits != null) { setCredits(rew.credits); me.profile.credits = rew.credits; }
    $("#game-play").innerHTML = `<div class="card" style="text-align:center"><h3>${correct}/3 correct${rew?.earned ? " — +1 credit ✦" : ""}</h3>
      <button class="primary" id="again">play again</button> <button class="outline" data-view="home">home</button></div>`;
    $("#again").addEventListener("click", () => playGame(axis));
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
