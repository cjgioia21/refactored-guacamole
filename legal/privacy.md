# Privacy Policy

**Version 1.0 — effective [EFFECTIVE_DATE]**

TrueHumanNature is operated by [LEGAL_ENTITY] in [PROVINCE], Canada. We handle
personal information under Canada's *Personal Information Protection and
Electronic Documents Act* (PIPEDA) and applicable provincial law.

Privacy officer / contact: **[CONTACT_EMAIL]**.

This policy is deliberately specific. A site that collects what this one
collects should not be vague about it.

---

## 1. The short version

- We collect your **face photograph**, your **age, gender and orientation**, your
  **political and sexual attitudes**, and optionally your **mental-health
  diagnoses**. Most of that is sensitive information and we treat it that way.
- Your **questionnaire answers are never shown to another user** in identifiable
  form. Not ever. They produce scores and anonymous aggregate percentages.
- Your **photograph is shown to other users** — that is the entire point of the
  service — but only to signed-in users, only through links that expire, and
  never on the open web.
- **We do not do face recognition. We do not create faceprints or face geometry.
  We do not use your photograph to train models. We do not sell anything.**
- You can see, correct, or delete your information at any time by emailing us.

## 2. What we collect, and why

**Account information** — email address, password (stored only as a salted
scrypt hash, never in readable form), and if you use Google sign-in, your Google
account identifier. *Why: to let you sign in and to contact you about your
account.*

**Your photograph** — the image you upload. *Why: it is the thing other users
rate. Without it the service does nothing.*

**Profile details** — display name (optional, and never shown in the rating
pool), age, gender and gender identity, sexual orientation, social media
handles, and your self-prediction of how attractive people will find you.
*Why: to filter who rates whom, to match you, and to produce your report.*

**Questionnaire answers** — your responses about sexual history and attitudes,
political views, net worth, dominance, pornography habits, and the 36-question
morality quiz. *Why: to build your trait profile and your Human Nature score,
which decides who you can match with, and to produce anonymous aggregate
statistics ("61% of people gave the same answer").*

**Mental-health information** — only if you choose to enter it; it is optional
and you can leave it blank. *Why: it feeds the "who likes you" demographic
report.*

**Activity** — who you picked over whom, how you answered dilemma rounds, your
guessing accuracy, credits earned and spent, and your win/loss record. *Why: it
is what produces every rating, ranking and report on the site.*

**Technical information** — IP address, approximate country (from your network),
and basic request logs. *Why: security, abuse and scraping detection, and
enforcing the regional restrictions in section 10.*

**Payment information** — if you buy credits, our payment processor handles your
card details. **We never see or store your card number.**

## 3. Sensitive information, called by its name

Political opinions, sex life, sexual orientation, and health information are
sensitive personal information. Under PIPEDA, sensitive information requires
your **express, informed, meaningful consent** — not a pre-ticked box and not
consent buried in a long document.

So, explicitly: when you answer those questions, you are consenting to us
collecting and processing that information for the purposes in section 2.
**You can decline.** The questionnaire is not required to hold an account,
though skipping the morality quiz means you cannot be matched with anyone.

**You can withdraw that consent at any time** by emailing us or deleting your
account. Withdrawing it means we delete those answers; it also means your
scores stop working, because they are computed from them.

## 4. Your photograph and biometrics — stated plainly

We know this is the part people care most about.

**We do not perform facial recognition.** We do not extract face geometry, we do
not compute a faceprint, template, hash or embedding of your face, we do not
match your face against any database, and we do not attempt to identify you from
your photograph. No part of the service does this, and no third party we use
does it either.

What we actually do to your photograph:

1. Re-encode it, which **removes all embedded metadata — including any GPS
   coordinates your phone recorded when the photo was taken.** We never store
   that location data.
2. Resize it.
3. Encrypt it and store it on our own server.
4. Show it to other signed-in users through links that expire after about ten
   minutes and only work in the session they were issued to.

**Who sees your photograph:** other signed-in users while rating; you; and our
human reviewers, who look at every photograph before it goes live and can see
your name, age and gender alongside it. That review is how we keep minors and
explicit content off the service, and it means a person on our side has seen
your photo. We would rather say so than let you find out later.

**What we cannot control:** a user who is shown your photograph can photograph
or screenshot their own screen. No website can prevent this. Please factor it in.

## 5. Who we share with

We do not sell personal information. We do not share it with advertisers. We do
not share it with data brokers.

We share only with:

- **Our hosting provider**, which stores the encrypted data.
- **Our payment processor**, if you buy credits.
- **Law enforcement or a court**, where we are legally required to, or where we
  believe in good faith it is necessary to prevent serious harm — in particular
  anything involving a minor.
- **A buyer of the business**, if it is ever sold. We would tell you first.

Other users see only what section 6 of the Terms describes: your photograph and
age while rating; your name and socials only if you match with them, and your
name only if you switched that on.

## 6. Aggregate statistics

The site publishes anonymous aggregates — "61% of people said they would take
the money", "38% would cheat for you". These are counts only. They contain no
names or identifiers, and we do not publish a statistic derived from so few
people that it could point to an individual.

## 7. How long we keep things

- **Your photograph** — until you replace it, delete it, or we reject it. A
  replaced or rejected photograph is erased from disk, not merely hidden.
- **Your account and profile** — until you delete your account.
- **After you delete your account** — your photograph and personal details are
  erased. Anonymous aggregate counts you have already contributed to (the "61%"
  figures) remain, because they contain nothing that identifies you and cannot be
  unpicked.
- **Logs** — up to 90 days.
- **Payment records** — as long as tax and accounting law requires, typically
  6–7 years.

## 8. How we protect it

- Photographs are **encrypted at rest with AES-256-GCM**.
- Passwords are salted and hashed with scrypt, never stored readably.
- Sessions use signed, HTTP-only cookies, over HTTPS only.
- Photograph links expire in minutes and are tied to a single signed-in session.
- Photograph access is rate-limited per account, and accounts exceeding it are
  logged, to make bulk scraping detectable.

No system is perfectly secure, and we won't claim otherwise. Encryption at rest
protects a stolen disk or a copied backup; it does not protect against a
compromised running server, and nothing protects against another user
screenshotting their screen.

**If a breach creates a real risk of significant harm to you, we will notify you
and the Office of the Privacy Commissioner of Canada, as PIPEDA requires.**

## 9. Your rights

You can, at any time:

- **See** what we hold about you;
- **Correct** anything wrong;
- **Delete** your account and your personal information;
- **Withdraw consent** for the sensitive questionnaire data;
- **Withdraw from the public boards** instantly;
- **Complain** — to us at [CONTACT_EMAIL], and if we don't resolve it, to the
  Office of the Privacy Commissioner of Canada at priv.gc.ca.

Email [CONTACT_EMAIL]. We respond within **30 days**, as PIPEDA requires.

## 10. Where the service is available

We do not offer TrueHumanNature in the **European Union**, the **United
Kingdom**, or the **State of Illinois**, and we block access from those regions.
US users are asked which state they are in and Illinois residents cannot
register.

We are being straightforward about why: the data this site collects is subject
to particularly strict rules in those places, and rather than handle it badly we
have chosen not to operate there.

## 11. Children

The service is **strictly 18+**. We do not knowingly collect information from
anyone under 18. Every photograph is reviewed by a person before it appears, and
an account we believe belongs to a minor is terminated and its photograph
deleted.

If you believe a minor has an account, email [CONTACT_EMAIL] immediately. We
treat those reports before anything else.

## 12. Changes

If we change this policy materially, we will raise the version number and ask
you to review it when you next sign in. We keep a record of which version you
accepted and when.

---

*Questions about any of this go to [CONTACT_EMAIL].*
