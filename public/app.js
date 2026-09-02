let currentUser = null;
let META = { mentalHealth: [], guessAxes: [] };
const selectedMH = new Set();

const $ = (s) => document.querySelector(s);
const api = (url, opts) => fetch(url, opts).then((r) => (r.status === 204 ? null : r.json()));
const post = (url, body) =>
  api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// --- navigation ---
document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));
function show(view) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.querySelectorAll("nav.tabs button").forEach((b) => b.classList.remove("active"));
  $("#view-" + view)?.classList.add("active");
  document.querySelector(`nav.tabs button[data-view="${view}"]`)?.classList.add("active");
  if (view === "matchup") loadMatchup();
  if (view === "report") loadReport();
  if (view === "connections") loadConnections();
  if (view === "games") renderGamePicker();
  window.scrollTo(0, 0);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function avatar(u, cls = "") {
  return u.photo
    ? `<img class="${cls}" src="${esc(u.photo)}" alt="${esc(u.name)}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'avatar ${cls}',textContent:'${esc((u.name||'?')[0])}'}))" />`
    : `<div class="avatar ${cls}">${esc((u.name || "?")[0])}</div>`;
}
function setCredits(n) { if (n != null) $("#credits").textContent = n; }

// --- bootstrap ---
(async function init() {
  META = await api("/api/meta");
  // mental-health chips
  $("#mh").innerHTML = META.mentalHealth
    .map((f) => `<span class="opt" data-mh="${f}">${f}</span>`)
    .join("") + `<span class="opt" data-mh="none">none</span>`;
  $("#mh").querySelectorAll("[data-mh]").forEach((el) =>
    el.addEventListener("click", () => {
      const f = el.dataset.mh;
      if (f === "none") { selectedMH.clear(); $("#mh").querySelectorAll(".sel").forEach((x) => x.classList.remove("sel")); }
      else { selectedMH.has(f) ? selectedMH.delete(f) : selectedMH.add(f); el.classList.toggle("sel"); }
    })
  );
  // questionnaire
  const { questions } = await api("/api/questions");
  $("#questions").innerHTML = questions
    .map(
      (q) => `<div class="q" data-qid="${q.id}">
        <div class="cat">${esc(q.category)}</div>
        <p>${esc(q.prompt)}</p>
        <div class="opts">${q.options.map((o, i) => `<span class="opt" data-i="${i}">${esc(o.label)}</span>`).join("")}</div>
      </div>`
    )
    .join("");
  $("#questions").querySelectorAll(".q").forEach((q) =>
    q.querySelectorAll(".opt").forEach((opt) =>
      opt.addEventListener("click", () => {
        q.querySelectorAll(".opt").forEach((o) => o.classList.remove("sel"));
        opt.classList.add("sel");
        q.dataset.answer = opt.dataset.i;
      })
    )
  );
})();

// --- onboarding submit ---
$("#onboard-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const answers = {};
  $("#questions").querySelectorAll(".q").forEach((q) => {
    if (q.dataset.answer != null) answers[q.dataset.qid] = Number(q.dataset.answer);
  });
  currentUser = await post("/api/users", {
    name: f.name.value,
    photo: f.photo.value,
    age: f.age.value,
    gender: f.gender.value,
    orientation: f.orientation.value,
    mentalHealth: [...selectedMH],
    socials: { instagram: f.instagram.value },
    answers,
  });
  setCredits(currentUser.credits);
  $("#tab-report").disabled = false;
  $("#tab-conn").disabled = false;
  show("matchup");
});

// --- matchup voting ---
async function loadMatchup() {
  const r = await api("/api/matchup" + (currentUser ? `?voter=${currentUser.id}` : ""));
  if (r.error) { $("#matchup").innerHTML = ""; $("#matchup-empty").hidden = false; return; }
  $("#matchup-empty").hidden = true;
  $("#matchup").innerHTML = [r.a, r.b]
    .map(
      (u) => `<div class="vs-card">
        ${avatar(u)}
        <h3>${esc(u.name)}${u.age ? ", " + u.age : ""}</h3>
        <button class="pick" data-win="${u.id}" data-lose="${u.id === r.a.id ? r.b.id : r.a.id}">choose</button>
      </div>`
    )
    .join("");
  $("#matchup").querySelectorAll(".pick").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!currentUser) { alert("Create a profile first to vote and earn credits."); return show("onboard"); }
      const res = await post("/api/vote", { voterId: currentUser.id, winnerId: btn.dataset.win, loserId: btn.dataset.lose });
      if (res.credits != null) setCredits(res.credits);
      loadMatchup();
    })
  );
}

// --- report ---
async function loadReport() {
  if (!currentUser) return ($("#report").innerHTML = `<p class="empty">Create a profile first.</p>`);
  const r = await api(`/api/users/${currentUser.id}/report`);
  const traitList = (arr) => arr.map((t) => `<span class="pill">${esc(t.label)}</span>`).join("") || `<span class="meta">not enough data yet</span>`;
  $("#report").innerHTML = `
    <div class="card">
      <div class="stat"><b>${r.attractivenessPercentile}%</b><span class="meta">more attractive than others · Elo ${r.elo} · ${r.matchups} matchups</span></div>
    </div>
    <div class="section-title">Your type <span class="hint">— learned from the photos you chose</span></div>
    <div class="card"><p style="margin:0;font-size:17px">${esc(r.yourType.text)}</p></div>
    <div class="section-title">The type of person attracted to you</div>
    <div class="card">${traitList(r.likedBy)}</div>
    <div class="section-title">Your matches <span class="hint">— mutual attraction</span></div>
    <div class="cards">${r.topMatches.map(matchCard).join("") || `<p class="empty">Vote in some matchups to unlock matches.</p>`}</div>
  `;
  $("#report").querySelectorAll("[data-share]").forEach((b) =>
    b.addEventListener("click", async () => {
      const { mutual } = await post(`/api/users/${currentUser.id}/share`, { targetId: b.dataset.share });
      b.textContent = mutual ? "matched — socials unlocked ✓" : "shared — waiting on them";
      b.disabled = true;
    })
  );
}
function matchCard(m) {
  return `<div class="card">
    <h3>${esc(m.name)}</h3>
    <div class="match-row"><span class="meta">mutual</span><span class="score">${m.score}</span></div>
    <div class="meta">you → them ${m.youLikeThem} · them → you ${m.theyLikeYou}</div>
    <button class="primary" style="width:100%;margin-top:10px" data-share="${m.id}">share my socials</button>
  </div>`;
}

// --- connections ---
async function loadConnections() {
  if (!currentUser) return ($("#connections").innerHTML = `<p class="empty">Create a profile first.</p>`);
  const conns = await api(`/api/users/${currentUser.id}/connections`);
  $("#connections").innerHTML = conns.length
    ? conns.map((c) => `<div class="card">
        <h3>${esc(c.name)}</h3>
        ${c.mutual
          ? `<div class="meta">✓ matched — socials:</div>${socialLinks(c.socials)}`
          : `<div class="meta">waiting on them to share back…</div>`}
      </div>`).join("")
    : `<p class="empty">No shares yet — open your report and tap “share my socials” on a match.</p>`;
}
function socialLinks(s) {
  const items = Object.entries(s || {}).map(([k, v]) => `<span class="pill">${esc(k)}: @${esc(v)}</span>`);
  return items.join("") || `<span class="meta">none provided</span>`;
}

// --- guessing games ---
function renderGamePicker() {
  $("#game-play").innerHTML = "";
  const labels = { age: "Age (older/younger)", gender: "Gender", mh: "Mental health", pol: "Politics", dom: "Dom or sub", adv: "Adventurousness", rel: "Religiosity", amb: "Ambition" };
  const axes = ["age", "gender", "mh", "pol", "dom", "adv"];
  $("#game-pick").innerHTML = axes
    .map((a) => `<div class="card" style="cursor:pointer" data-axis="${a}"><div class="cat">GUESS</div><h3>${esc(labels[a] || a)}</h3><span class="meta">play →</span></div>`)
    .join("");
  $("#game-pick").querySelectorAll("[data-axis]").forEach((el) => el.addEventListener("click", () => playGame(el.dataset.axis)));
}

async function playGame(axis) {
  $("#game-pick").innerHTML = "";
  let round = 0, correct = 0;
  const prompts = {
    age: ["Older or younger than 30?", [["under 30", "under 30"], ["30+", "30+"]]],
    gender: ["What's their gender?", [["woman", "woman"], ["man", "man"], ["nonbinary", "nonbinary"]]],
    mh: ["Do they report a mental-health condition?", [["yes", "yes"], ["no", "no"]]],
  };
  const next = async () => {
    if (round >= 3) return finish();
    round++;
    const g = await api(`/api/guess?axis=${axis}${currentUser ? "&voter=" + currentUser.id : ""}`);
    if (g.error) return ($("#game-play").innerHTML = `<p class="empty">Need more profiles to play.</p>`);
    const [prompt, opts] = prompts[axis] || [
      `Are they high or low on ${axis}?`, [["low", "low"], ["high", "high"]],
    ];
    $("#game-play").innerHTML = `
      <div class="progress">Round ${round}/3 · ${correct} correct</div>
      <div class="game-target">${avatar(g.target)}<div class="game-q">${esc(prompt)}</div>
      <div class="game-actions">${opts.map(([label, val]) => `<button class="primary" data-g="${val}">${esc(label)}</button>`).join("")}</div></div>
      <div class="result" id="game-result"></div>`;
    $("#game-play").querySelectorAll("[data-g]").forEach((b) =>
      b.addEventListener("click", async () => {
        $("#game-play").querySelectorAll("[data-g]").forEach((x) => (x.disabled = true));
        const out = await post("/api/guess", { targetId: g.target.id, axis, guess: b.dataset.g, voterId: currentUser?.id });
        if (out.correct) correct++;
        const res = $("#game-result");
        res.className = "result " + (out.correct ? "ok" : "no");
        res.textContent = (out.correct ? "Correct! " : "Nope — ") + "actually: " + out.actualLabel;
        setTimeout(next, 1100);
      })
    );
  };
  const finish = async () => {
    let creditMsg = "";
    if (currentUser) {
      const rew = await post("/api/games/reward", { voterId: currentUser.id, correct });
      if (rew.credits != null) setCredits(rew.credits);
      creditMsg = rew.earned ? " — you earned a credit ✦" : "";
    }
    $("#game-play").innerHTML = `<div class="card" style="text-align:center">
      <h3>${correct}/3 correct${esc(creditMsg)}</h3>
      <button class="primary" onclick="location.reload ? null : null" id="again">play again</button></div>`;
    $("#again").addEventListener("click", renderGamePicker);
  };
  next();
}
