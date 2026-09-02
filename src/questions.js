// Self-report questionnaire. Each answer maps onto one trait axis in [-1, 1].
// Axes are the dimensions we profile people (and voters) on.

export const AXES = {
  pol: ["left", "right"], // political economics
  auth: ["libertarian", "authoritarian"], // social freedom
  rel: ["secular", "religious"],
  adv: ["reserved", "adventurous"], // sexual openness
  dom: ["submissive", "dominant"],
  mono: ["non-monogamous", "monogamous"],
  ext: ["introvert", "extravert"],
  amb: ["laid-back", "ambitious"],
  fam: ["unattached", "family-oriented"],
  risk: ["cautious", "risk-taking"],
};

// q(id, category, prompt, axis, [[label, value], ...])
const q = (id, category, prompt, axis, options) => ({
  id,
  category,
  prompt,
  axis,
  options: options.map(([label, value]) => ({ label, value })),
});

const SCALE5 = (a, b) => [
  [a, -1],
  [`somewhat ${a}`, -0.5],
  ["neutral", 0],
  [`somewhat ${b}`, 0.5],
  [b, 1],
];

export const QUESTIONS = [
  // Politics
  q("q_taxes", "politics", "Taxes on high earners should be…", "pol",
    [["much higher", -1], ["higher", -0.5], ["as they are", 0], ["lower", 0.5], ["much lower", 1]]),
  q("q_market", "politics", "Free markets vs. regulation?", "pol", SCALE5("regulation", "free markets")),
  q("q_guns", "politics", "Gun ownership should be…", "pol",
    [["banned", -1], ["restricted", -0.5], ["as is", 0], ["expanded", 0.5], ["unrestricted", 1]]),
  // Authority / social
  q("q_speech", "politics", "Offensive speech should be…", "auth",
    [["allowed", -1], ["mostly allowed", -0.5], ["depends", 0], ["mostly limited", 0.5], ["limited", 1]]),
  q("q_order", "politics", "Order vs. individual freedom?", "auth", SCALE5("freedom", "order")),
  q("q_trad", "politics", "Traditional values should be…", "auth", SCALE5("questioned", "upheld")),
  // Religion
  q("q_faith", "beliefs", "How important is religion to you?", "rel",
    [["not at all", -1], ["a little", -0.5], ["neutral", 0], ["important", 0.5], ["central", 1]]),
  q("q_afterlife", "beliefs", "Do you believe in an afterlife?", "rel",
    [["no", -1], ["doubt it", -0.5], ["unsure", 0], ["probably", 0.5], ["yes", 1]]),
  q("q_pray", "beliefs", "How often do you pray or meditate spiritually?", "rel",
    [["never", -1], ["rarely", -0.5], ["sometimes", 0], ["often", 0.5], ["daily", 1]]),
  // Sexual openness
  q("q_casual", "relationships", "How do you feel about casual sex?", "adv", SCALE5("against it", "all for it")),
  q("q_experiment", "relationships", "How adventurous are you in the bedroom?", "adv", SCALE5("vanilla", "very")),
  q("q_bodycount", "relationships", "Your past partner count is…", "adv",
    [["0", -1], ["a few", -0.5], ["average", 0], ["above average", 0.5], ["high", 1]]),
  // Dominance
  q("q_lead", "relationships", "In relationships you tend to…", "dom", SCALE5("follow", "lead")),
  q("q_control", "relationships", "In bed you prefer to be…", "dom",
    [["submissive", -1], ["mostly sub", -0.5], ["switch", 0], ["mostly dom", 0.5], ["dominant", 1]]),
  q("q_decide", "personality", "In a group you usually…", "dom", SCALE5("go with the flow", "make the call")),
  // Monogamy
  q("q_open", "relationships", "Open relationships are…", "mono",
    [["for me", -1], ["okay", -0.5], ["not sure", 0], ["not for me", 0.5], ["never", 1]]),
  q("q_loyal", "relationships", "Ideal number of partners at once?", "mono",
    [["several", -1], ["a couple", -0.5], ["flexible", 0], ["one, mostly", 0.5], ["exactly one", 1]]),
  // Extraversion
  q("q_weekend", "personality", "Ideal weekend?", "ext",
    [["home alone", -1], ["small hangout", -0.5], ["either", 0], ["night out", 0.5], ["big party", 1]]),
  q("q_meet", "personality", "Meeting new people is…", "ext", SCALE5("draining", "energizing")),
  q("q_talk", "personality", "In conversations you…", "ext", SCALE5("listen", "lead")),
  // Ambition
  q("q_career", "lifestyle", "Career ambition level?", "amb", SCALE5("content", "driven")),
  q("q_work", "lifestyle", "Work-life balance vs. success?", "amb", SCALE5("balance", "success")),
  q("q_goals", "lifestyle", "Five-year plan?", "amb",
    [["live in the moment", -1], ["loose ideas", -0.5], ["some goals", 0], ["clear goals", 0.5], ["mapped out", 1]]),
  // Family
  q("q_kids", "lifestyle", "Do you want kids?", "fam",
    [["never", -1], ["probably not", -0.5], ["unsure", 0], ["probably", 0.5], ["definitely", 1]]),
  q("q_settle", "lifestyle", "Settling down is…", "fam", SCALE5("not the goal", "the goal")),
  q("q_family_time", "lifestyle", "Family closeness matters…", "fam", SCALE5("little", "a lot")),
  // Risk
  q("q_money", "lifestyle", "With money you…", "risk", SCALE5("save", "gamble")),
  q("q_travel", "lifestyle", "Spontaneous trip tomorrow?", "risk", SCALE5("no way", "already packed")),
  q("q_rules", "personality", "Rules are…", "risk", SCALE5("there for a reason", "made to be broken")),
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
  for (const axis of Object.keys(AXES)) {
    vec[axis] = count[axis] ? sum[axis] / count[axis] : 0;
  }
  return vec;
}

// Human label for a signed axis value, e.g. pol:+0.7 -> "right".
export function axisLabel(axis, value) {
  const [low, high] = AXES[axis];
  if (Math.abs(value) < 0.15) return `middle ${axis}`;
  const word = value > 0 ? high : low;
  const strength = Math.abs(value) > 0.6 ? "very " : "";
  return `${strength}${word}`;
}
