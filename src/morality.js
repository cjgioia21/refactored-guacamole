// The morality quiz — the questionnaire behind the Human Nature score.
//
// The other question bank (src/questions.js) measures appetites: how much you
// sleep around, how much money you have, how hard you goon. This one measures
// what you'd actually *do* to another person when nobody is watching.
//
// Every option carries a raw value in -2..+2, so a completed quiz scores
// -72..+72. Higher = worse. That's the whole scale, and it's deliberately not
// disguised: people should be able to see exactly how they earned the number.
//
// Two rules held while writing these, because they cost nothing and protect the
// product: the discomfort is always aimed at the person answering, and no
// dilemma is built on children.

// The six ways to be a bad person, in the order they're presented.
export const VICES = {
  greed: { label: "Greed", emoji: "💰", ends: ["gives it away", "takes it all"] },
  betrayal: { label: "Betrayal", emoji: "🔪", ends: ["loyal", "sells you out"] },
  cruelty: { label: "Cruelty", emoji: "😈", ends: ["kind", "enjoys it"] },
  deceit: { label: "Deceit", emoji: "🎭", ends: ["honest", "lies by default"] },
  apathy: { label: "Apathy", emoji: "🫥", ends: ["gives a damn", "couldn't care less"] },
  depravity: { label: "Depravity", emoji: "🕳️", ends: ["well-adjusted", "something's wrong"] },
};

// m(id, vice, prompt, [[label, value], ...]) — value is the raw -2..+2 score.
const m = (id, vice, prompt, options) => ({
  id,
  vice,
  category: VICES[vice].label,
  prompt,
  options: options.map(([label, value]) => ({ label, value })),
});

export const MORAL_QUESTIONS = [
  // ---------- Greed ----------
  m("gr1", "greed", "A button gives you $10,000,000. A stranger you'll never meet dies. Nobody ever finds out. Do you press it?", [
    ["never — that's murder", -2],
    ["no, but I'd think about it", -1],
    ["I genuinely don't know", 0],
    ["yes, once", 1],
    ["how many times can I press it?", 2],
  ]),
  m("gr2", "greed", "How much money would it take for you to never speak to your family again?", [
    ["no amount", -2],
    ["more than I'll ever be offered", -1],
    ["a life-changing amount", 0],
    ["a few hundred grand", 1],
    ["make me an offer", 2],
  ]),
  m("gr3", "greed", "You find a wallet with $2,000 cash and the owner's ID inside.", [
    ["return it, cash untouched", -2],
    ["return it and hope for a reward", -1],
    ["hand it to police and let them sort it", 0],
    ["keep the cash, post the wallet back", 1],
    ["keep all of it", 2],
  ]),
  m("gr4", "greed", "A friend asks you to invest in their business. You know it's going to fail.", [
    ["tell them, even if it ends the friendship", -2],
    ["gently warn them off", -1],
    ["stay out of it", 0],
    ["say nothing — not my money", 1],
    ["say nothing and short them somehow", 2],
  ]),
  m("gr5", "greed", "Your elderly neighbour is selling something worth ten times what they're asking. They don't know.", [
    ["tell them what it's worth", -2],
    ["pay them a fair price anyway", -1],
    ["pay a bit over asking", 0],
    ["pay asking price", 1],
    ["pay asking and try to haggle down", 2],
  ]),
  m("gr6", "greed", "\"I'd rather be rich and disliked than broke and loved.\"", [
    ["strongly disagree", -2],
    ["disagree", -1],
    ["depends on the day", 0],
    ["agree", 1],
    ["obviously — this isn't even a question", 2],
  ]),

  // ---------- Betrayal ----------
  m("bt1", "betrayal", "Your partner of five years is disfigured in a fire. Do you stay?", [
    ["without hesitating", -2],
    ["yes", -1],
    ["I'd want to say yes", 0],
    ["probably not, honestly", 1],
    ["no", 2],
  ]),
  m("bt2", "betrayal", "Your best friend's partner makes a move on you.", [
    ["shut it down and tell my friend", -2],
    ["shut it down, say nothing", -1],
    ["freeze and avoid them both", 0],
    ["enjoy it, then shut it down", 1],
    ["see where it goes", 2],
  ]),
  m("bt3", "betrayal", "You could get the promotion by quietly making a colleague look incompetent.", [
    ["never", -2],
    ["no — I'd hate myself", -1],
    ["depends how much I want it", 0],
    ["if they wouldn't trace it to me", 1],
    ["that's just how promotions work", 2],
  ]),
  m("bt4", "betrayal", "A friend tells you a secret that would go viral if you shared it.", [
    ["it dies with me", -2],
    ["I'd keep it", -1],
    ["I'd tell one person", 0],
    ["I'd tell a few people", 1],
    ["it's already posted", 2],
  ]),
  m("bt5", "betrayal", "Have you ever cheated on someone, or would you?", [
    ["never have, never would", -2],
    ["never have, and I don't think I could", -1],
    ["I'd like to think not", 0],
    ["have, or would in the right situation", 1],
    ["regularly, and I sleep fine", 2],
  ]),
  m("bt6", "betrayal", "Your friend's ex — the one they're still not over — wants you.", [
    ["absolutely not", -2],
    ["I'd ask my friend first and respect the answer", -1],
    ["I'd ask, then do what I want", 0],
    ["I'd do it and tell them after", 1],
    ["I'd do it and let them find out", 2],
  ]),

  // ---------- Cruelty ----------
  m("cr1", "cruelty", "Someone who made your school years hell posts a cancer diagnosis. Your honest first reaction?", [
    ["genuine sympathy", -2],
    ["sympathy, and I feel bad it took a beat", -1],
    ["nothing at all", 0],
    ["a small, ugly flicker of satisfaction", 1],
    ["I read the comments for fun", 2],
  ]),
  m("cr2", "cruelty", "How much do you enjoy watching someone you dislike fail publicly?", [
    ["I don't — it makes me uncomfortable", -2],
    ["not much", -1],
    ["a normal amount", 0],
    ["a lot", 1],
    ["it's my primary source of joy", 2],
  ]),
  m("cr3", "cruelty", "You're arguing and you know the one sentence that would genuinely break them.", [
    ["never say it", -2],
    ["bite my tongue", -1],
    ["hint at it", 0],
    ["say it if they push me", 1],
    ["say it — that's what it's for", 2],
  ]),
  m("cr4", "cruelty", "A stranger is being publicly humiliated online. You could pile on anonymously.", [
    ["I'd defend them", -2],
    ["I'd scroll past", -1],
    ["I'd read the whole thread", 0],
    ["I'd like the best insult", 1],
    ["I'd add my own", 2],
  ]),
  m("cr5", "cruelty", "Someone cuts you off in traffic and then breaks down a mile ahead.", [
    ["stop and help", -2],
    ["hope someone helps them", -1],
    ["drive on, no feeling", 0],
    ["laugh", 1],
    ["slow down to enjoy it properly", 2],
  ]),
  m("cr6", "cruelty", "Have you ever made someone cry on purpose?", [
    ["never, and the idea upsets me", -2],
    ["no", -1],
    ["once, and I regret it", 0],
    ["a few times", 1],
    ["yes — and I was good at it", 2],
  ]),

  // ---------- Deceit ----------
  m("dc1", "deceit", "The cashier undercharges you $200. It'll come out of their wages.", [
    ["tell them immediately", -2],
    ["go back once I notice", -1],
    ["feel bad, keep it", 0],
    ["keep it, no feelings involved", 1],
    ["keep it and go back to that till", 2],
  ]),
  m("dc2", "deceit", "How much of your dating profile is strictly true?", [
    ["all of it, unflatteringly so", -2],
    ["all of it, best angles", -1],
    ["true-ish", 0],
    ["a generous interpretation", 1],
    ["we'll sort it out in person", 2],
  ]),
  m("dc3", "deceit", "Lying on a résumé to get a job you could actually do.", [
    ["never", -2],
    ["no, it'd eat at me", -1],
    ["small stretches", 0],
    ["yes — everyone does", 1],
    ["already did, got the job", 2],
  ]),
  m("dc4", "deceit", "Your friend asks whether you like their partner. You don't.", [
    ["tell them honestly", -2],
    ["tell them gently", -1],
    ["dodge the question", 0],
    ["lie to their face", 1],
    ["lie to them, trash the partner to everyone else", 2],
  ]),
  m("dc5", "deceit", "You break something at someone's house and nobody sees.", [
    ["own up and pay for it", -2],
    ["own up", -1],
    ["mention it vaguely later", 0],
    ["say nothing", 1],
    ["say nothing and let someone else take it", 2],
  ]),
  m("dc6", "deceit", "\"Everyone lies constantly — pretending otherwise is the real dishonesty.\"", [
    ["strongly disagree", -2],
    ["disagree", -1],
    ["neutral", 0],
    ["agree", 1],
    ["strongly agree", 2],
  ]),

  // ---------- Apathy ----------
  m("ap1", "apathy", "Give up every holiday for the rest of your life and 100 strangers live. Do you?", [
    ["instantly", -2],
    ["yes", -1],
    ["I'd agonise, then probably yes", 0],
    ["probably not", 1],
    ["they're strangers", 2],
  ]),
  m("ap2", "apathy", "What fraction of your income would you give to save lives if it worked perfectly?", [
    ["most of it", -2],
    ["a serious chunk", -1],
    ["10%", 0],
    ["whatever's left over", 1],
    ["none — I earned it", 2],
  ]),
  m("ap3", "apathy", "Someone collapses in the street. There are other people around.", [
    ["I'm the first one there", -2],
    ["I help", -1],
    ["I check that someone else is helping", 0],
    ["I keep walking", 1],
    ["I film it", 2],
  ]),
  m("ap4", "apathy", "How often do you actually think about whether something you buy hurt someone to make?", [
    ["constantly — it changes what I buy", -2],
    ["often", -1],
    ["sometimes", 0],
    ["rarely", 1],
    ["never, and I'd rather not start", 2],
  ]),
  m("ap5", "apathy", "A friend is going through the worst month of their life and keeps calling.", [
    ["I pick up every time", -2],
    ["I pick up", -1],
    ["I pick up most of the time", 0],
    ["I start letting it ring", 1],
    ["I mute them until it passes", 2],
  ]),
  m("ap6", "apathy", "\"Other people's problems are not my responsibility.\"", [
    ["strongly disagree", -2],
    ["disagree", -1],
    ["neutral", 0],
    ["agree", 1],
    ["strongly agree", 2],
  ]),

  // ---------- Depravity ----------
  m("dp1", "depravity", "You can read anyone's private messages for 24 hours, undetected. Whose do you open first?", [
    ["nobody's — I'd refuse", -2],
    ["my own, to see what people say about me", -1],
    ["a public figure's", 0],
    ["my partner's or my ex's", 1],
    ["everyone I know, one by one", 2],
  ]),
  m("dp2", "depravity", "One button makes everyone you dislike vanish. It also takes 1% of everyone else.", [
    ["I destroy the button", -2],
    ["I don't press it", -1],
    ["I hold it for a long time", 0],
    ["I press it", 1],
    ["I pressed it before finishing the question", 2],
  ]),
  m("dp3", "depravity", "How dark is your search history, honestly?", [
    ["boring", -2],
    ["normal", -1],
    ["some things I'd rather explain in person", 0],
    ["I clear it for a reason", 1],
    ["it should probably be evidence", 2],
  ]),
  m("dp4", "depravity", "Total anonymity, zero consequences, one day. What actually happens?", [
    ["nothing different", -2],
    ["I'd say some things I've held back", -1],
    ["some petty theft, some honesty", 0],
    ["a lot of things I'd deny later", 1],
    ["you don't want to know", 2],
  ]),
  m("dp5", "depravity", "Have you ever wanted to hurt someone — really hurt them — and meant it?", [
    ["never", -2],
    ["not seriously", -1],
    ["once, briefly", 0],
    ["more than once", 1],
    ["I think about it more than I should", 2],
  ]),
  m("dp6", "depravity", "If everyone could see your true opinions of the people closest to you, what happens?", [
    ["nothing — they already know", -2],
    ["a couple of awkward conversations", -1],
    ["I'd lose a friend", 0],
    ["I'd lose most of them", 1],
    ["I'd have to leave the country", 2],
  ]),
];

// How many answers before the score is trustworthy enough to gate matches on.
export const MORAL_MIN_ANSWERED = 24;
export const MORAL_TOTAL = MORAL_QUESTIONS.length;

const byId = (id) => MORAL_QUESTIONS.find((q) => q.id === id);

// Raw sum over answered questions: -72..+72 for a complete quiz. Higher = worse.
export function moralScore(answers = {}) {
  let score = 0;
  for (const q of MORAL_QUESTIONS) {
    const opt = q.options[answers[q.id]];
    if (opt) score += opt.value;
  }
  return score;
}

export function moralAnswered(answers = {}) {
  return MORAL_QUESTIONS.reduce((n, q) => n + (q.options[answers[q.id]] ? 1 : 0), 0);
}

// Per-vice totals, so the number is never a black box.
export function moralBreakdown(answers = {}) {
  const out = {};
  for (const vice of Object.keys(VICES)) out[vice] = { score: 0, answered: 0, max: 0, ...VICES[vice] };
  for (const q of MORAL_QUESTIONS) {
    out[q.vice].max += 2;
    const opt = q.options[answers[q.id]];
    if (!opt) continue;
    out[q.vice].score += opt.value;
    out[q.vice].answered += 1;
  }
  return out;
}

// The vice you scored worst on — the headline of the report.
export function worstVice(answers = {}) {
  const rows = Object.entries(moralBreakdown(answers));
  const [key, row] = rows.sort((a, b) => b[1].score - a[1].score)[0];
  return { key, ...row };
}

// The shareable payload: a band label and a line of copy that does not flatter.
const BANDS = [
  { min: -72, label: "Sanctimonious", line: "You answered like someone who expects to be graded. Either you're genuinely good, or you're a liar with excellent instincts." },
  { min: -30, label: "Decent", line: "Boringly alright. You'd return the wallet and resent doing it. Nobody writes songs about you." },
  { min: -8, label: "Compromised", line: "You have a price and you already know roughly what it is. Most people are here. That is not the comfort you think it is." },
  { min: 14, label: "Rotten", line: "You'd take the money, and you'd be fine afterwards. The people around you have not worked this out yet." },
  { min: 36, label: "Irredeemable", line: "You didn't hesitate on any of the ones that were supposed to make you hesitate. Whoever ends up matched with you: good luck." },
];

export function moralVerdict(score = 0) {
  let band = BANDS[0];
  for (const b of BANDS) if (score >= b.min) band = b;
  return { ...band, score };
}
