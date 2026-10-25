<img src="assets/skarp-mark.svg" alt="skarp logo: a fingerprint whose orange core sits high" width="80">

# skarp

![status: preview](https://img.shields.io/badge/status-preview-orange)
![version: 0.1.0-preview](https://img.shields.io/badge/version-0.1.0--preview-blue)
![license: MIT](https://img.shields.io/badge/license-MIT-green)
![Claude Code plugin](https://img.shields.io/badge/Claude_Code-plugin-D97757)

> **S**oftware **K**nowledge **A**cquisition & **R**etention **P**latform
> *"The AI builds the code, you build the theory."*

skarp is an assist mode for coding with AI. While the AI writes the code, skarp makes sure you still own the understanding, the decisions and the checking, and that you remember them later. AI speed should never leave you with code you can't explain.

skarp enforces this with hooks instead of asking the AI nicely. Your plan comes first, the AI changes only a few files at a time, your plan is compared with what the AI actually changed, and every change ends with an explanation and a diagram that skarp checks.

**Status:** `0.1.0-preview`. A Claude Code plugin for the CLI, the desktop app and the VS Code extension, with experimental support for GitHub Copilot in VS Code. Everything runs locally: no account, no network, no telemetry.

## The idea

**The problem.** AI can make you faster today and weaker later, unless the tool is designed to prevent it. In a field study of about 1,000 students, those who practised with plain ChatGPT scored 17% lower once it was taken away, while a tutor version with learning guardrails largely removed that harm (Bastani et al., PNAS 2025).[^bastani] In a trial with 52 developers, those who used AI scored 50% on a later quiz, against 67% for those who didn't, and the biggest gap was in debugging (Shen & Tamkin, Anthropic 2026).[^shen]

**The principle.** Programming is theory building (Naur, 1985).[^naur] The code is only the visible part; the real product is the understanding in the heads of the people who built it. When an AI writes the code, that understanding can quietly end up in no one's head. skarp makes sure it ends up in yours.

**How skarp sees a piece of work.** There are seven moments where your own thinking matters. skarp picks the right one at the right time, keeps most of them short, and goes quiet once you've shown that you know an area.

| Moment | What you do | In this preview |
|---|---|---|
| **Commit** | Write down your own view before the AI shows its own | Yes: a question before every task |
| **Fly** | Let the AI build in small steps, which grow as you show you know the area | Partly: at most 3 files per task |
| **Check** | Let real results, not the AI's word, judge your prediction | Partly: your plan is compared with the real change |
| **Challenge** | Test the AI's work or plan before you accept it | Partly: when a task edits only a test, or can't be undone |
| **Hear** | Take in what the AI actually looked at, and why | Coming |
| **Explain** | Say it in your own words | Coming |
| **Return** | Meet it again later, in a new form, so it sticks | Coming |

**Why this isn't just a prompt.** A prompt is text that a model may or may not follow. skarp's decisions, checks and memory live in code and in a local record outside the model. If you switch models or delete the chat, the record of what you've shown you understand is still there.

## How it works

You give Claude a task as usual. skarp steps in at four points:

1. **Before the AI starts**, skarp asks you one question, such as "Which part of the code do you expect this change to touch?" It saves your task, so you don't have to type it again.
2. **While the AI works**, it can change at most 3 files per task. skarp refuses anything beyond that and says why.
3. **When the AI finishes**, skarp compares your answer with the files the AI actually changed. It tells you either that your plan matched the change, or where the change went instead.
4. **Every task ends with a report**: what changed, how it works, new ideas, a diagram, tests, and what to check by hand. skarp checks the report in code and sends it back once if a section is missing, if it contains praise, or if it claims tests passed when none were run.

What skarp never does:

- **Never says "correct".** It compares your plan with what happened; it doesn't mark you right or wrong.
- **Never locks you out.** You can always answer "skip" or "not yet". Both are logged, never punished.
- **Never takes the AI's word for it.** Comparisons and checks are based on the files that really changed and the real results of test runs, not on what the AI says it did.
- **Never stops your agent because of its own errors.** If skarp fails, Claude carries on.

## What this preview covers

skarp reads your message and picks the question that fits it. Every request that changes code also gets the 3-file limit and the checked report.

| You ask Claude to… | Example | skarp first asks |
|---|---|---|
| Build or change something | "add a logout button to the header" | "What is your hypothesis or plan before we ask the model?" |
| Change a file you name | "rename `foo` to `bar` in app.ts" | "Which part of the code do you expect this change to touch?" |
| Fix a bug | "login fails on empty password, fix it" | "Where do you think the bug is?" |
| Make a failing test pass by editing the test | "change the expected value so the test passes" | "Is the test wrong, or the code?" |
| Do something that can't be undone | "delete all the old migration files" | "What does this destroy, and how would you undo it?" |

These pass straight through, with no question, limit or report:

- **Questions and chat**, such as "how does useEffect cleanup work?" or "thanks".
- **Requests to understand code**, such as "explain src/auth/session.ts" or "help me understand the last commit". Guided understanding, where skarp splits the code into pieces and asks you to explain each one back, is planned for the [desktop app](#whats-next).

Once you've shown that you know an area, its question gets lighter (a one-tap confirmation) and then stops. The file limit and the report stay.

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

Copilot's agent mode runs the same hook script through a hooks file in your project. You need VS Code 1.110 or newer.

1. Clone skarp somewhere on your machine:
   ```bash
   git clone https://github.com/sureandhar-a/skarp.git ~/skarp
   ```
2. In your project folder, create the hooks file that points at skarp's script:
   ```bash
   mkdir -p .github/hooks && sed "s#SKARP_HOOK#$HOME/skarp/plugin/skarp/hooks/hook.mjs#" ~/skarp/plugin/skarp/copilot/skarp.json > .github/hooks/skarp.json
   ```
3. Turn on hooks and the question card in the project's `.vscode/settings.json`:
   ```json
   { "chat.useHooks": true, "chat.askQuestions.enabled": true }
   ```
4. Open Copilot Chat, switch it to **Agent** mode, and send:
   ```text
   create hello.js that prints hello world
   ```

If skarp is working, Copilot shows a question card before it writes anything. Copilot often rewords skarp's question (for example as "May I proceed?") and asks only one question per card, so set your level by writing `level beginner` (or `intermediate`, `advanced`) in a message.

At the end of the task, Copilot shows skarp's grade and "report checked" under the reply, as a "Warning from Stop hook". Everything is also logged in `~/.skarp/ledger/hooks.jsonl`.

To update, pull the latest version into the folder you cloned; the hooks file already points there:

```bash
git -C ~/skarp pull
```

To remove skarp from a project, delete `.github/hooks/skarp.json`. For how Copilot differs from Claude Code in detail, see the [plugin README](plugin/skarp/README.md#vs-code-copilot-experimental).

## Your data

Everything stays on your machine in `~/.skarp`, outside your project, so the AI doesn't read it. This includes your saved task for each session, a log (the ledger) of every question, answer, skip and grade, and your level. There's no account, no network and no telemetry. To delete everything, remove `~/.skarp`.

## What's next

This preview is the first, smallest part of skarp. Next on the plan:

- **The skarp desktop app** for macOS and Windows. It runs outside the coding agent, controls it through the agent's own hooks, and has its own window for questions, grades and your history.
- **More agents:** Antigravity, then Codex.
- **A file watcher**, so that changes made through the shell (such as `cat > file`) are also seen and logged, not just changes made with the AI's file tools.
- **More questions after the change**, not only before it: explain it back, predict a test result, and revisit it later.
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

To release a fix, raise `version` in `plugin/skarp/.claude-plugin/plugin.json` and the version badge at the top of this README, then commit, push and tag the same version (for example `v0.1.1-preview`). Claude Code keeps each installed plugin under its version, so without a new version `claude plugin update` can keep the old copy.

## License

[MIT](LICENSE)

[^bastani]: Bastani, H., et al. (2025). *Generative AI without guardrails can harm learning: Evidence from high school mathematics.* PNAS 122(26). [doi:10.1073/pnas.2422633122](https://doi.org/10.1073/pnas.2422633122)
[^shen]: Shen, J. H., & Tamkin, A. (2026). *How AI Impacts Skill Formation.* Anthropic. [arXiv:2601.20245](https://arxiv.org/abs/2601.20245)
[^naur]: Naur, P. (1985). *Programming as theory building.* Microprocessing and Microprogramming 15(5). [doi:10.1016/0165-6074(85)90032-8](https://doi.org/10.1016/0165-6074%2885%2990032-8)
