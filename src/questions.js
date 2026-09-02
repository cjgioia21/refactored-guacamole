// Self-report questionnaire. Each answer maps onto one trait axis in [-1, 1].
// The five axes are exactly the five guessing-game dimensions, so each gets a
// deep bank (12 questions) for an accurate per-trait score.

export const AXES = {
  bodycount: ["low bodycount", "high bodycount"], // sexual experience / promiscuity
  networth: ["lower income", "higher income"], // income / wealth / class
  pol: ["left", "right"], // politics
  dom: ["submissive", "dominant"], // dominance
  gooner: ["tame", "gooner"], // porn / goon habits
};

// q(id, category, prompt, axis, [[label, value], ...])
const q = (id, category, prompt, axis, options) => ({
  id, category, prompt, axis,
  options: options.map(([label, value]) => ({ label, value })),
});

// Common 5-point scales (pass reverse=true to flip direction).
const S5 = (a, b) => [[a, -1], [`somewhat ${a}`, -0.5], ["neutral", 0], [`somewhat ${b}`, 0.5], [b, 1]];
const FREQ = [["never", -1], ["rarely", -0.5], ["sometimes", 0], ["often", 0.5], ["constantly", 1]];
const AGREE = [["strongly disagree", -1], ["disagree", -0.5], ["neutral", 0], ["agree", 0.5], ["strongly agree", 1]];
const rev = (scale) => scale.map(([l, v]) => [l, -v]);

export const QUESTIONS = [
  // ---------- Bodycount (sexual experience) ----------
  q("bc1", "Bodycount", "How many people have you slept with?", "bodycount",
    [["0", -1], ["1–3", -0.5], ["4–9", 0], ["10–25", 0.5], ["25+", 1]]),
  q("bc2", "Bodycount", "New partners in the last year?", "bodycount",
    [["none", -1], ["one", -0.5], ["a couple", 0], ["several", 0.5], ["lots", 1]]),
  q("bc3", "Bodycount", "How do you feel about casual sex?", "bodycount", S5("against it", "love it")),
  q("bc4", "Bodycount", "Would you sleep with someone on a first date?", "bodycount",
    [["never", -1], ["unlikely", -0.5], ["maybe", 0], ["probably", 0.5], ["already have", 1]]),
  q("bc5", "Bodycount", "How often do you use hookup apps?", "bodycount", FREQ),
  q("bc6", "Bodycount", "Friends-with-benefits arrangements?", "bodycount",
    [["never", -1], ["once", -0.5], ["a few", 0], ["several", 0.5], ["a specialty", 1]]),
  q("bc7", "Bodycount", "\"A high body count is no big deal.\"", "bodycount", AGREE),
  q("bc8", "Bodycount", "How many people have you kissed?", "bodycount",
    [["0–2", -1], ["3–9", -0.5], ["10–25", 0], ["25–50", 0.5], ["50+", 1]]),
  q("bc9", "Bodycount", "Do you regret past hookups?", "bodycount", rev(S5("often", "never"))),
  q("bc10", "Bodycount", "One-night stands are…", "bodycount", S5("not for me", "a good time")),
  q("bc11", "Bodycount", "How openly do you talk about your sex life?", "bodycount", S5("very private", "an open book")),
  q("bc12", "Bodycount", "Age you became sexually active suggests you're…", "bodycount",
    [["a late bloomer", -1], ["later than most", -0.5], ["average", 0], ["earlier than most", 0.5], ["very early", 1]]),

  // ---------- Net worth (income / wealth / class) ----------
  q("nw1", "Net worth", "Your annual income is…", "networth",
    [["very low", -1], ["below average", -0.5], ["average", 0], ["above average", 0.5], ["very high", 1]]),
  q("nw2", "Net worth", "Do you rent or own your home?", "networth",
    [["rent, with roommates", -1], ["rent alone", -0.5], ["it's complicated", 0], ["own with a mortgage", 0.5], ["own outright", 1]]),
  q("nw3", "Net worth", "Savings and investments?", "networth",
    [["none", -1], ["a little", -0.5], ["some", 0], ["a solid cushion", 0.5], ["substantial", 1]]),
  q("nw4", "Net worth", "Dropping $500 on a whim would…", "networth",
    [["be impossible", -1], ["really hurt", -0.5], ["make me think", 0], ["be fine", 0.5], ["not register", 1]]),
  q("nw5", "Net worth", "How often do you buy luxury or designer items?", "networth", FREQ),
  q("nw6", "Net worth", "International trips per year?", "networth",
    [["never", -1], ["rarely", -0.5], ["once", 0], ["a few", 0.5], ["frequently", 1]]),
  q("nw7", "Net worth", "Financial stress in your life?", "networth", rev(S5("constant", "none"))),
  q("nw8", "Net worth", "Did you grow up wealthy?", "networth", S5("we struggled", "very comfortable")),
  q("nw9", "Net worth", "Highest level of education?", "networth",
    [["high school", -1], ["some college", -0.5], ["bachelor's", 0], ["master's", 0.5], ["doctorate/professional", 1]]),
  q("nw10", "Net worth", "Your car (or ride) is…", "networth",
    [["none / transit", -1], ["old and cheap", -0.5], ["mid-range", 0], ["nice", 0.5], ["luxury", 1]]),
  q("nw11", "Net worth", "Family money or inheritance?", "networth", S5("none", "significant")),
  q("nw12", "Net worth", "Your neighborhood is…", "networth",
    [["rough", -1], ["working-class", -0.5], ["average", 0], ["nice", 0.5], ["affluent", 1]]),

  // ---------- Politics (left / right) ----------
  q("pol1", "Politics", "Taxes on high earners should be…", "pol",
    [["much higher", -1], ["higher", -0.5], ["as they are", 0], ["lower", 0.5], ["much lower", 1]]),
  q("pol2", "Politics", "Free markets vs. regulation?", "pol", S5("regulate more", "free markets")),
  q("pol3", "Politics", "Gun ownership should be…", "pol",
    [["banned", -1], ["restricted", -0.5], ["as is", 0], ["expanded", 0.5], ["unrestricted", 1]]),
  q("pol4", "Politics", "Immigration should be…", "pol", S5("more open", "more restricted")),
  q("pol5", "Politics", "Government social spending should…", "pol", S5("increase", "shrink")),
  q("pol6", "Politics", "Abortion should be…", "pol", S5("always legal", "heavily restricted")),
  q("pol7", "Politics", "Climate policy should be…", "pol", S5("aggressive", "hands-off")),
  q("pol8", "Politics", "Traditional values should be…", "pol", S5("questioned", "upheld")),
  q("pol9", "Politics", "Universal healthcare?", "pol", rev(AGREE)),
  q("pol10", "Politics", "On crime, you favor…", "pol", S5("reform", "law and order")),
  q("pol11", "Politics", "Overall you lean…", "pol",
    [["very left", -1], ["left", -0.5], ["center", 0], ["right", 0.5], ["very right", 1]]),
  q("pol12", "Politics", "Diversity & identity initiatives are…", "pol", S5("essential", "overdone")),

  // ---------- Dominance (dom / sub) ----------
  q("dom1", "Dominance", "In relationships you tend to…", "dom", S5("follow", "lead")),
  q("dom2", "Dominance", "In bed you prefer to be…", "dom",
    [["submissive", -1], ["mostly sub", -0.5], ["a switch", 0], ["mostly dom", 0.5], ["dominant", 1]]),
  q("dom3", "Dominance", "In a group you usually…", "dom", S5("go with the flow", "make the call")),
  q("dom4", "Dominance", "Giving orders vs. taking them?", "dom", S5("prefer taking", "prefer giving")),
  q("dom5", "Dominance", "\"I like being in charge.\"", "dom", AGREE),
  q("dom6", "Dominance", "Restraints: you'd rather…", "dom", S5("be tied up", "do the tying")),
  q("dom7", "Dominance", "Who initiates?", "dom", S5("I wait to be pursued", "I make the first move")),
  q("dom8", "Dominance", "At work you're seen as…", "dom", S5("a team player", "a leader")),
  q("dom9", "Dominance", "Telling a partner exactly what to do is…", "dom", S5("uncomfortable", "a turn-on")),
  q("dom10", "Dominance", "Your assertiveness is…", "dom", S5("low-key", "forceful")),
  q("dom11", "Dominance", "Decisions in a couple should be…", "dom", S5("mostly theirs", "mostly mine")),
  q("dom12", "Dominance", "Being praised vs. being obeyed?", "dom", S5("praised", "obeyed")),

  // ---------- Gooner Nature (porn / goon habits) ----------
  q("gn1", "Gooner Nature", "How often do you watch porn?", "gooner", FREQ),
  q("gn2", "Gooner Nature", "A typical session lasts…", "gooner",
    [["minutes", -1], ["short", -0.5], ["a while", 0], ["long", 0.5], ["hours", 1]]),
  q("gn3", "Gooner Nature", "Do you edge / drag it out?", "gooner", FREQ),
  q("gn4", "Gooner Nature", "How many tabs on the go?", "gooner",
    [["one", -1], ["two", -0.5], ["a few", 0], ["many", 0.5], ["an armada", 1]]),
  q("gn5", "Gooner Nature", "Paid adult subscriptions (OnlyFans, etc.)?", "gooner",
    [["never", -1], ["once", -0.5], ["a couple", 0], ["several", 0.5], ["many", 1]]),
  q("gn6", "Gooner Nature", "\"I could easily go a month without.\"", "gooner", rev(AGREE)),
  q("gn7", "Gooner Nature", "How deep are your kinks/fetishes?", "gooner", S5("vanilla", "very niche")),
  q("gn8", "Gooner Nature", "Late-night NSFW browsing?", "gooner", FREQ),
  q("gn9", "Gooner Nature", "Toys or gadgets involved?", "gooner", S5("none", "a collection")),
  q("gn10", "Gooner Nature", "Follow adult creators/accounts?", "gooner", S5("none", "lots")),
  q("gn11", "Gooner Nature", "Would you call yourself a gooner?", "gooner", rev(S5("absolutely not", "proudly"))),
  q("gn12", "Gooner Nature", "Porn's role in your week is…", "gooner", S5("minimal", "a main event")),
];

// Build a trait vector (axis -> mean value) from answers { qid: optionIndex }.
export function profileFromAnswers(answers = {}) {
  const sum = {};
  const count = {};
  for (const question of QUESTIONS) {
    const idx = answers[question.id];
    if (idx == null) continue;
    const opt = question.options[idx];
    if (!opt) continue;
    sum[question.axis] = (sum[question.axis] || 0) + opt.value;
    count[question.axis] = (count[question.axis] || 0) + 1;
  }
  const vec = {};
  for (const axis of Object.keys(AXES)) vec[axis] = count[axis] ? sum[axis] / count[axis] : 0;
  return vec;
}

// Human label for a signed axis value, e.g. pol:+0.7 -> "very right".
export function axisLabel(axis, value) {
  const [low, high] = AXES[axis];
  if (Math.abs(value) < 0.15) return `middle-of-the-road ${axis === "pol" ? "politically" : axis}`;
  const word = value > 0 ? high : low;
  const strength = Math.abs(value) > 0.6 ? "very " : "";
  return `${strength}${word}`;
}
