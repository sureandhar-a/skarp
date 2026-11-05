# How skarp works

The idea behind skarp, what it does at each step, and what this preview covers. To install it, see [INSTALL.md](INSTALL.md).

## The idea

**The problem.** AI can make you faster today and weaker later, unless the tool is designed to prevent it. In a field study of about 1,000 students, those who practised with plain ChatGPT scored 17% lower once it was taken away, while a tutor version with learning guardrails largely removed that harm (Bastani et al., PNAS 2025).[^bastani] In a trial with 52 developers, those who used AI scored 50% on a later quiz, against 67% for those who didn't, and the biggest gap was in debugging (Shen & Tamkin, Anthropic 2026).[^shen]

**The principle.** Programming is theory building (Naur, 1985).[^naur] The code is only the visible part; the real product is the understanding in the heads of the people who built it. When an AI writes the code, that understanding can quietly end up in no one's head. skarp makes sure it ends up in yours.

**How skarp sees a piece of work.** There are seven moments where your own thinking matters. skarp picks the right one at the right time, keeps most of them short, and goes quiet once you've shown that you know an area.

| Moment | What you do | In this preview |
|---|---|---|
| **Commit** | Write down your own view before the AI shows its own | Yes: a question before every task, explanation and brainstorm |
| **Fly** | Let the AI build in small steps, which grow as you show you know the area | Partly: the AI builds after Hear and your plan is graded against the diff; predicting while it works and step sizes need the desktop app |
| **Check** | Let real results, not the AI's word, judge your prediction | Partly: your plan is compared with the real change |
| **Challenge** | Test the AI's work or plan before you accept it | Partly: when a task edits only a test or can't be undone, and the brainstorm stress test |
| **Hear** | Take in what the AI actually looked at, and why | Yes: on ground you haven't proven, a walkthrough with one blank to fill, checked against the line it cites |
| **Explain** | Say it in your own words | Partly: an explanation ends with "this works because ___" |
| **Return** | Meet it again later, in a new form, so it sticks | Partly: the next chat opens with a recall of a past fill or a question you put off; each report ends with what's kept and what's not yet |

**Why this isn't just a prompt.** A prompt is text that a model may or may not follow. skarp's decisions, checks and memory live in code and in a local record outside the model. If you switch models or delete the chat, the record of what you've shown you understand is still there.

## How it works

You give Claude or Copilot a task as usual. skarp steps in at five points:

1. **Before the AI starts**, skarp asks you one question, such as "Where do you think the bug is?" The options are neutral hints from skarp, never the AI's own guesses, and free text always works. It saves your task, so you don't have to type it again.
2. **Before any change, on ground you haven't proven** (Hear), the AI walks you through what the code does now and what will change, compared with your answer, and ends with one sentence to fill in ("applyDiscount subtracts ___ (src/cart.js:7)"). skarp checks your fill against that line in the code, and refuses writes until you fill it or say "not yet" (kept as owed). A miss gets it explained another way and one more blank; a second miss gets the plain answer, then the build.
3. **While the AI works**, the task stays open across messages: "still failing" continues it without a new question. Until the work is done, the AI ends each turn with a short status instead of the report.
4. **When the task is done**, skarp compares your answer with every file the task changed. It tells you either that your plan matched the change, or where the change went instead.
5. **Every task ends with a report**: what changed, how it works, new ideas, a diagram, tests, and what to check by hand. skarp checks the report in code and sends it back once if a section is missing, if it contains praise, or if it claims tests passed when none were run.

Explanations and brainstorms get their own flow, below.

What skarp never does:

- **Never says "correct".** It compares your plan with what happened; it doesn't mark you right or wrong.
- **Never locks you out.** You can always answer "skip" or "not yet". Both are logged, never punished.
- **Never takes the AI's word for it.** Comparisons and checks are based on the files that really changed and the real results of test runs, not on what the AI says it did.
- **Never stops your agent because of its own errors.** If skarp fails, Claude carries on.

## What this preview covers

skarp reads your message and picks the question that fits it. Every request that changes code also gets the checked report.

| You ask Claude to… | Example | skarp first asks |
|---|---|---|
| Build or change something | "add a logout button to the header" | "What is your hypothesis or plan before we ask the model?" |
| Change a file you name | "rename `foo` to `bar` in app.ts" | "Which part of the code do you expect this change to touch?" |
| Fix a bug | "login fails on empty password, fix it" | "Where do you think the bug is?" |
| Make a failing test pass by editing the test | "change the expected value so the test passes" | "Is the test wrong, or the code?" |
| Do something that can't be undone | "delete all the old migration files" | "What does this destroy, and how would you undo it?" |

| Ask for an explanation | "explain the repo to me", "how does the cache work?" | "What do you think it does now, and which part matters most to you?" |
| Brainstorm | "can we brainstorm on caching?", "I have a rough idea: …" | "What's your idea or first guess?" |

**Explain.** After your guess, the AI must give a checked explanation under `## skarp: explained`: big picture, diagram, key pieces, how a request flows, new ideas, where to start reading, your guess compared with the code, and a last question for you: "this works because ___". It changes no files.

<a id="brainstorm"></a>**Brainstorm.** The AI acts as a senior colleague who asks questions and stress-tests your ideas, not an idea generator or a yes-man:

1. **You go first**, and the AI stays quiet while you list your ideas. People who think alone first and then pool their ideas produce about three times as many (Girotra et al., 2010), and AI ideas shown first make people's ideas converge (Doshi & Hauser, 2024).
2. **It asks rather than tells.** In a pre-registered trial with 486 people, an AI that asked reflective questions improved idea quality and kept ideas more varied and more your own than an AI that rewrote them (Maier et al., 2025, preprint).
3. **Each idea is restated neutrally before it's judged**, because models agree more with ideas stated in the first person and with confidence ("Ask Don't Tell", UK AISI, 2026, preprint). Agreement with no evidence is sent back.
4. **Every verdict needs evidence**, a pre-mortem comes before hard-to-undo decisions, and **you decide**, with at least two options and your reason in your own words.
5. **It's all kept**: the conversation, every idea (who raised it, for and against, verdict, evidence) and the decision, so you can continue it later.

These pass straight through, with no question or report: **questions and chat**, such as "thanks" or a quick one-line question.

Once you've shown that you know an area, its task question gets lighter (a one-tap confirmation) and its walkthrough short; then both go quiet, and skarp logs why. The report stays.

Every chat opens and closes with Return: a new chat in the same project starts with a short recall of something you filled in before (or a question you put off), and every report ends with **Kept** and **Not yet**.

## Your data

Everything stays on your machine in `~/.skarp`, outside your project, so the AI doesn't read it. This includes a log (the ledger) of every question, answer, skip and grade with its project folder, every report and explanation as a Markdown file in `reports/`, every brainstorm (its conversation, ideas and decision) in `brainstorms/`, and your level. There's no account and no network, and skarp never sends anything by itself. To delete everything, remove `~/.skarp`.

skarp also keeps a private **diagnostic log** of how it behaved, in `~/.skarp/log`: what came in, what skarp decided, what it sent back and how long that took. It includes your messages, the AI's replies and question cards, but never file contents or command output, and anything shaped like a key or token is removed. It's deleted after 14 days (30 if that day has a flag, 50 MB at most). Turn it off with `npx skarp-copilot log off`.

**Reporting a problem:** type `/flag` in chat (on Claude Code, `/skarp:flag` also works), with what went wrong or on its own. Then run `npx skarp-copilot report`, or take the ready file from `~/.skarp/shared/skarp-report.md`. That file is a masked copy: only common English words stay readable, and names, paths and code are replaced. You can add your own names to `~/.skarp/always-mask.txt`, which matters for names that are also ordinary words. Masking can miss things, so read the file before you share it. You send it yourself, and screenshots aren't masked.

On VS Code, setup can also turn on VS Code's own telemetry, written to a local file with no prompts or replies, so a report can show which model answered. It only happens if you say yes, and `npx skarp-copilot remove` undoes it.

## What's next

This preview is the first, smallest part of skarp. Next on the plan:

- **The skarp desktop app** for macOS and Windows. It runs outside the coding agent, controls it through the agent's own hooks, and has its own window for questions, grades and your history.
- **More agents:** Antigravity, then Codex.
- **A file watcher**, so that changes made through the shell (such as `cat > file`) are also seen and logged, not just changes made with the AI's file tools.
- **More questions after the change**: predict a test result, and revisit it later.
- **Checking claims against the code**: in a brainstorm, the AI's factual claims ("no cache exists") verified by reading the repo.
- **Your history:** a view of what you've owned, skipped or still owe, built from the local ledger.

[^bastani]: Bastani, H., et al. (2025). *Generative AI without guardrails can harm learning: Evidence from high school mathematics.* PNAS 122(26). [doi:10.1073/pnas.2422633122](https://doi.org/10.1073/pnas.2422633122)
[^shen]: Shen, J. H., & Tamkin, A. (2026). *How AI Impacts Skill Formation.* Anthropic. [arXiv:2601.20245](https://arxiv.org/abs/2601.20245)
[^naur]: Naur, P. (1985). *Programming as theory building.* Microprocessing and Microprogramming 15(5). [doi:10.1016/0165-6074(85)90032-8](https://doi.org/10.1016/0165-6074%2885%2990032-8)
