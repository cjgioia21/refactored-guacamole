const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const SLOTS = ["morning", "afternoon", "evening", "night"];
let currentUser = null;

const $ = (s) => document.querySelector(s);
const api = (url, opts) => fetch(url, opts).then((r) => (r.status === 204 ? null : r.json()));

// --- navigation ---
document.querySelectorAll("nav button").forEach((btn) => {
  btn.addEventListener("click", () => show(btn.dataset.view));
});
function show(view) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.querySelectorAll("nav button").forEach((b) => b.classList.remove("active"));
  $("#view-" + view).classList.add("active");
  document.querySelector(`nav button[data-view="${view}"]`)?.classList.add("active");
  if (view === "members") loadMembers();
  if (view === "pairings") $("#pairings").innerHTML = "";
}

// --- availability grid ---
const availEl = $("#availability");
DAYS.forEach((day) => {
  const box = document.createElement("div");
  box.className = "avail-day";
  box.innerHTML =
    `<strong>${day}</strong>` +
    SLOTS.map(
      (s) => `<label><input type="checkbox" data-day="${day}" value="${s}" />${s}</label>`
    ).join("");
  availEl.appendChild(box);
});
function readAvailability() {
  const a = {};
  availEl.querySelectorAll("input:checked").forEach((cb) => {
    (a[cb.dataset.day] ||= []).push(cb.value);
  });
  return a;
}

// --- create profile ---
$("#profile-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const payload = {
    name: f.name.value,
    subjects: f.subjects.value,
    goals: f.goals.value,
    languages: f.languages.value,
    level: f.level.value,
    style: f.style.value,
    bio: f.bio.value,
    availability: readAvailability(),
  };
  currentUser = await api("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  f.reset();
  availEl.querySelectorAll("input:checked").forEach((cb) => (cb.checked = false));
  loadMatches();
});

// --- matches ---
async function loadMatches() {
  if (!currentUser) return;
  show("matches");
  document.querySelector('nav button[data-view="members"]').classList.remove("active");
  $("#matches-for").textContent = `Best study partners for ${currentUser.name}`;
  const matches = await api(`/api/users/${currentUser.id}/matches?limit=12`);
  $("#matches").innerHTML = matches.length
    ? matches.map(matchCard).join("")
    : `<p class="empty">No other members yet — invite a friend or check back soon.</p>`;
}

function matchCard(m) {
  const u = m.user;
  const shared = new Set(m.sharedSubjects);
  const subjects = (u.subjects || [])
    .map((s) => `<span class="tag ${shared.has(s.toLowerCase()) ? "shared" : ""}">${esc(s)}</span>`)
    .join("");
  const bars = Object.entries(m.breakdown)
    .map(([k, v]) => `<div class="meta">${k}<div class="bar"><i style="width:${pct(k, v)}%"></i></div></div>`)
    .join("");
  return `<div class="card">
    <span class="score">${m.score}</span>
    <h3>${esc(u.name)}</h3>
    <div class="meta">${esc(u.level)} · ${esc(u.style)}</div>
    <div class="tags">${subjects}</div>
    ${u.bio ? `<p class="meta">${esc(u.bio)}</p>` : ""}
    ${bars}
  </div>`;
}
const MAXW = { subjects: 35, availability: 25, goals: 15, style: 10, level: 10, language: 5 };
const pct = (k, v) => Math.round((v / (MAXW[k] || 1)) * 100);

// --- members ---
async function loadMembers() {
  const users = await api("/api/users");
  $("#members").innerHTML = users.length
    ? users.map(memberCard).join("")
    : `<p class="empty">No members yet.</p>`;
}
function memberCard(u) {
  const subjects = (u.subjects || []).map((s) => `<span class="tag">${esc(s)}</span>`).join("");
  const pick = currentUser && currentUser.id !== u.id
    ? `<a class="btn" onclick="setUser('${u.id}')">view as / matches →</a>`
    : "";
  return `<div class="card">
    <h3>${esc(u.name)}</h3>
    <div class="meta">${esc(u.level)} · ${esc(u.style)}</div>
    <div class="tags">${subjects}</div>
    ${u.bio ? `<p class="meta">${esc(u.bio)}</p>` : ""}
    ${pick}
  </div>`;
}
window.setUser = async (id) => {
  currentUser = await api("/api/users/" + id);
  loadMatches();
};

// --- pairings ---
$("#run-pairings").addEventListener("click", async () => {
  const { pairs, unpaired } = await api("/api/pairings");
  const pairCards = pairs
    .map(
      (p) => `<div class="card"><div class="pair">
        <strong>${esc(p.a.name)}</strong>
        <span class="vs">⇄ ${p.score}</span>
        <strong>${esc(p.b.name)}</strong>
      </div></div>`
    )
    .join("");
  const rest = unpaired.length
    ? `<div class="card"><div class="meta">Unpaired: ${unpaired.map((u) => esc(u.name)).join(", ")}</div></div>`
    : "";
  $("#pairings").innerHTML = pairs.length ? pairCards + rest : `<p class="empty">Need at least two members.</p>`;
});

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
