<img src="assets/skarp-mark.svg" alt="skarp logo: a fingerprint whose orange core sits high" width="80">

# skarp

![status: preview](https://img.shields.io/badge/status-preview-orange)
![version: 0.2.0-preview](https://img.shields.io/badge/version-0.2.0--preview-blue)
![license: MIT](https://img.shields.io/badge/license-MIT-green)
![Claude Code plugin](https://img.shields.io/badge/Claude_Code-plugin-D97757)

> **S**oftware **K**nowledge **A**cquisition & **R**etention **P**latform
> *"The AI builds the code, you build the theory."*

skarp is an assist mode for coding with AI. While the AI writes the code, skarp makes sure you still own the understanding, the decisions and the checking, and that you remember them later. AI speed should never leave you with code you can't explain.

skarp enforces this with hooks instead of asking the AI nicely. Your plan comes first, the AI changes only a few files at a time, your plan is compared with what the AI actually changed, and every change ends with an explanation and a diagram that skarp checks.

**Status:** `0.2.0-preview`. A Claude Code plugin for the CLI, the desktop app and the VS Code extension, with experimental support for GitHub Copilot in VS Code. Everything runs locally: no account, no network, no telemetry.

## The idea

**The problem.** AI can make you faster today and weaker later, unless the tool is designed to prevent it. In a field study of about 1,000 students, those who practised with plain ChatGPT scored 17% lower once it was taken away, while a tutor version with learning guardrails largely removed that harm (Bastani et al., PNAS 2025).[^bastani] In a trial with 52 developers, those who used AI scored 50% on a later quiz, against 67% for those who didn't, and the biggest gap was in debugging (Shen & Tamkin, Anthropic 2026).[^shen]

**The principle.** Programming is theory building (Naur, 1985).[^naur] The code is only the visible part; the real product is the understanding in the heads of the people who built it. When an AI writes the code, that understanding can quietly end up in no one's head. skarp makes sure it ends up in yours.

**How skarp sees a piece of work.** There are seven moments where your own thinking matters. skarp picks the right one at the right time, keeps most of them short, and goes quiet once you've shown that you know an area.

| Moment | What you do | In this preview |
|---|---|---|
| **Commit** | Write down your own view before the AI shows its own | Yes: a question before every task, explanation and brainstorm |
| **Fly** | Let the AI build in small steps, which grow as you show you know the area | Coming |
| **Check** | Let real results, not the AI's word, judge your prediction | Partly: your plan is compared with the real change |
| **Challenge** | Test the AI's work or plan before you accept it | Partly: when a task edits only a test or can't be undone, and the brainstorm stress test |
| **Hear** | Take in what the AI actually looked at, and why | Coming |
| **Explain** | Say it in your own words | Partly: an explanation ends with "this works because ___" |
| **Return** | Meet it again later, in a new form, so it sticks | Coming |

**Why this isn't just a prompt.** A prompt is text that a model may or may not follow. skarp's decisions, checks and memory live in code and in a local record outside the model. If you switch models or delete the chat, the record of what you've shown you understand is still there.

## How it works

You give Claude or Copilot a task as usual. skarp steps in at four points:

1. **Before the AI starts**, skarp asks you one question, such as "Where do you think the bug is?" The options are neutral hints from skarp, never the AI's own guesses, and free text always works. It saves your task, so you don't have to type it again.
2. **While the AI works**, the task stays open across messages: "still failing" continues it without a new question. Until the work is done, the AI ends each turn with a short status instead of the report.
3. **When the task is done**, skarp compares your answer with every file the task changed. It tells you either that your plan matched the change, or where the change went instead.
4. **Every task ends with a report**: what changed, how it works, new ideas, a diagram, tests, and what to check by hand. skarp checks the report in code and sends it back once if a section is missing, if it contains praise, or if it claims tests passed when none were run.

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

Once you've shown that you know an area, its task question gets lighter (a one-tap confirmation) and then stops. The report stays.

## Install (Claude Code)

One install covers the Claude Code CLI, the Code tab in the Claude desktop app, and the Claude Code extension in VS Code.

```bash
claude plugin marketplace add sureandhar-a/skarp
```

```bash
claude plugin install skarp@skarp-tools
```

skarp needs Node 24.2 or newer on your PATH. For more on what it does, what it stores and the known gaps, see the [plugin README](plugin/skarp/README.md).

### Try it

Open Claude Code in an empty folder and send:

```text
create hello.js that prints hello world
```

If skarp is working, you'll see:

1. **A question card before any code is written**, headed "skarp", asking "Which part of the code do you expect this change to touch?" with a few options and "Skip". The first time, it also asks your level (beginner, intermediate or advanced).
2. **Your answer releases the task.** Claude then writes `hello.js` without you retyping anything.
3. **A report at the end**, under the heading `## skarp: what changed`, with Changes, How it works, New ideas, Diagram, Tests and checks, and Check by hand.
4. **A grade**, telling you whether your answer matched the file Claude really changed. skarp sees files that Claude writes with its file tools or with shell redirects (`>`, `>>`, `tee`). If Claude writes a file some other way, such as `cp` or `sed -i`, skarp doesn't see it, so there's no grade for that task. This is a known gap in the preview.

Now send `thanks`. Nothing happens: chat passes straight through.

If no question card appears, check that the plugin is listed, that Node is 24.2 or newer, and that skarp has started logging:

```bash
claude plugin list
```

```bash
node --version
```

```bash
tail -n 3 ~/.skarp/ledger/hooks.jsonl
```

If skarp is running, the last command shows recent lines with `"type":"ask"` or `"type":"user_message"`. If the file doesn't exist, the hook isn't running.

To update:

```bash
claude plugin marketplace update skarp-tools && claude plugin update skarp@skarp-tools
```

Then start a new Claude Code session. Sessions that were already open keep the old version.

To remove:

```bash
claude plugin uninstall skarp@skarp-tools
```

## Install (VS Code)

### Claude Code extension

Nothing extra to do: the [Claude Code install](#install-claude-code) above covers the extension too. Test it with the same [Try it](#try-it) prompt in the extension's chat.

### GitHub Copilot (experimental)

You need VS Code 1.110 or newer and Node 24.2 or newer. One command sets skarp up for all your projects:

```bash
npx skarp-copilot setup
```

It copies skarp's hook to `~/.skarp/bin/` and writes `~/.copilot/hooks/skarp.json`. Then open Copilot Chat, in whatever mode you use, and send:

```text
create hello.js that prints hello world
```

If skarp is working, Copilot shows skarp's question before it writes anything. Check what ran with:

```bash
npx skarp-copilot status
```

It prints what's installed and whether your last piece of work was asked, answered and saved, with ✓/✗ and field names only, never what you wrote. If nothing was logged, your VS Code may use its older Local runtime; run `npx skarp-copilot setup --project` in your project and reload VS Code.

Copilot asks only one question per card, so set your level by writing `level beginner` (or `intermediate`, `advanced`) in a message. On VS Code 1.143, Copilot doesn't show skarp's end-of-task messages; run `npx skarp-copilot status` to see the last check and grade. When skarp sends the AI back, Copilot passes skarp's note to the AI as a chat message, so you may see it in the chat.

To update, run `npx skarp-copilot@latest setup`. To remove, run `npx skarp-copilot remove`. For how Copilot differs from Claude Code, see the [plugin README](plugin/skarp/README.md#github-copilot-in-vs-code-experimental).

## Your data

Everything stays on your machine in `~/.skarp`, outside your project, so the AI doesn't read it. This includes a log (the ledger) of every question, answer, skip and grade with its project folder, every report and explanation as a Markdown file in `reports/`, every brainstorm (its conversation, ideas and decision) in `brainstorms/`, and your level. There's no account, no network and no telemetry. To delete everything, remove `~/.skarp`.

## What's next

This preview is the first, smallest part of skarp. Next on the plan:

- **The skarp desktop app** for macOS and Windows. It runs outside the coding agent, controls it through the agent's own hooks, and has its own window for questions, grades and your history.
- **More agents:** Antigravity, then Codex.
- **A file watcher**, so that changes made through the shell (such as `cat > file`) are also seen and logged, not just changes made with the AI's file tools.
- **More questions after the change**: predict a test result, and revisit it later.
- **Checking claims against the code**: in a brainstorm, the AI's factual claims ("no cache exists") verified by reading the repo.
- **Your history:** a view of what you've owned, skipped or still owe, built from the local ledger.

## Feedback and bugs

This is a preview, and your feedback shapes what comes next. Open an [issue](https://github.com/sureandhar-a/skarp/issues) and describe what you ran, what you expected and what happened. The last few lines of `~/.skarp/ledger/hooks.jsonl` help; check them for anything private before you share them.

## Repo layout

| Path | What |
|---|---|
| `plugin/skarp` | The Claude Code plugin: the hooks config and the bundled hook script |
| `packages/hooks` | Source of the hook handler, bundled into `plugin/skarp` |
| `packages/schema` | JSON Schema for messages and ledger events, and the generated types |
| `packages/kernel` | Pure rules with no I/O (enforced by a test) |
| `packages/core` | Sessions, the agent loop and ports; `handle(message) -> messages` |
| `packages/rpc` | JSON-RPC over stdio (planned) |
| `packages/ui` | React + Tailwind kit, design tokens and Storybook |
| `packages/cli` | `npx skarp-copilot`: Copilot setup, status and remove (published to npm as `skarp-copilot`) |
| `packages/vscode` | The VS Code extension (in progress, not released) |
| `packages/conformance` | A test suite that drives `core` through a scripted host |
| `assets/` | Brand marks |

Dependency direction: `schema` <- `kernel` <- `core` <- `rpc` / `vscode`.

## Develop

```bash
nvm use            # Node 24
npm i -g pnpm      # or: corepack enable
pnpm install
pnpm test          # build + all tests
pnpm lint
```

After changing `packages/hooks`, rebuild the plugin's hook:

```bash
pnpm build && pnpm --filter @skarp/hooks build:plugin
```

To release a fix, raise `version` in `plugin/skarp/.claude-plugin/plugin.json`, in `packages/cli/package.json` and in the version badge at the top of this README, then commit, push and tag the same version (for example `v0.2.1-preview`), and publish the CLI with `cd packages/cli && npm publish --tag preview`. Claude Code keeps each installed plugin under its version, so without a new version `claude plugin update` can keep the old copy.

## License

[MIT](LICENSE)

[^bastani]: Bastani, H., et al. (2025). *Generative AI without guardrails can harm learning: Evidence from high school mathematics.* PNAS 122(26). [doi:10.1073/pnas.2422633122](https://doi.org/10.1073/pnas.2422633122)
[^shen]: Shen, J. H., & Tamkin, A. (2026). *How AI Impacts Skill Formation.* Anthropic. [arXiv:2601.20245](https://arxiv.org/abs/2601.20245)
[^naur]: Naur, P. (1985). *Programming as theory building.* Microprocessing and Microprogramming 15(5). [doi:10.1016/0165-6074(85)90032-8](https://doi.org/10.1016/0165-6074%2885%2990032-8)
