// Gap step: how much of your answer shows up in what the AI touched.
// Code-aware word overlap: identifiers split into parts, rare words weigh more (IDF).

const STOP = new Set(
  "the a an and or but to of in on at for with is are was be it this that i you we my your will would should could do does not no so if then than as by from into".split(
    " ",
  ),
);

// getUserById -> getuserbyid, get, user, by, id; src/auth/login.ts -> the path and each part
export function tokens(text: string): string[] {
  const out = new Set<string>();
  for (const word of text.match(/[\w./-]+/g) ?? []) {
    const whole = word.toLowerCase().replace(/^[./-]+|[./-]+$/g, "");
    if (whole.length > 1 && !STOP.has(whole)) out.add(whole);
    for (const part of word.split(/[./_-]|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)) {
      const p = part.toLowerCase();
      if (p.length > 1 && !STOP.has(p)) out.add(p);
    }
  }
  return [...out];
}

// 0 = nothing in common, 1 = every word of the answer is in the touched files or their contents.
// Each line of `touched` counts as one document for IDF, so a word found everywhere weighs little.
export function overlap(answer: string, touched: { path: string; content: string }[]): number {
  const words = tokens(answer);
  if (words.length === 0) return 0;
  if (touched.some((t) => answer.includes(t.path))) return 1; // you named a file it changed

  const docs = touched
    .flatMap((t) => [t.path, ...t.content.split("\n")])
    .map((d) => new Set(tokens(d)));
  const idf = (w: string) =>
    Math.log((docs.length + 1) / (docs.filter((d) => d.has(w)).length + 1)) + 1;
  const seen = (w: string) => docs.some((d) => d.has(w));

  let total = 0;
  let matched = 0;
  for (const w of words) {
    const weight = idf(w);
    total += weight;
    if (seen(w)) matched += weight;
  }
  return matched / total;
}

// limit: one fixed threshold; tune it from logged gaps in the test week.
export const ALIGNED = 0.3;
