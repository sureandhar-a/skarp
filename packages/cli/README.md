# skarp-copilot

**Own what you ship.** This package sets up [skarp](https://github.com/sureandhar-a/skarp) for GitHub Copilot in VS Code (experimental). skarp is a set of hooks: it asks for your view before the AI starts, checks the AI's work in code and keeps a local record. It works in any Copilot mode; there's no separate agent or chat mode to pick.

Using Claude Code instead? Install the plugin: see the [main README](https://github.com/sureandhar-a/skarp#readme).

## Setup

You need VS Code 1.110 or newer and Node 24.2 or newer (`node --version`).

```bash
npx skarp-copilot setup
```

This copies skarp's hook to `~/.skarp/bin/` and writes one user-level hooks file, `~/.copilot/hooks/skarp.json`, for all your projects. If Node is too old, it installs nothing.

Then open Copilot Chat and send:

```text
create hello.js that prints hello world
```

If skarp is working, Copilot shows skarp's question before it writes anything.

If no question appears, your VS Code may use the older Local runtime. In your project, run this and reload VS Code:

```bash
npx skarp-copilot setup --project
```

It writes `.github/hooks/skarp.json` and switches on `chat.useHooks` in `.vscode/settings.json`, keeping your other settings.

## Commands

| Command | What it does |
|---|---|
| `npx skarp-copilot setup` | Set up skarp for all your projects (`--project` for this project only) |
| `npx skarp-copilot status` | What's installed, and whether your last task, explanation or brainstorm went through each step. ✓/✗ and field names only, never what you wrote |
| `npx skarp-copilot@latest setup` | Update |
| `npx skarp-copilot remove` | Remove the hooks; add `--all` to delete your records too |

## What skarp does

skarp picks one of three ways of working from your message:

- **A task** ("fix the login bug"): one question first, such as "Where do you think the bug is?", with fixed hints and free text. Then the AI explains what the code does now and what will change, quizzes you in your own words, and skarp asks "Ready for the AI to build it?". No file changes before that; the explanation is never skipped, only the answering. The task stays open until it's fixed, and the AI ends with a checked report. Your plan is graded against the files that really changed: "your plan matched the change" or "the change went where your plan didn't". Never "correct".
- **An explanation** ("explain the repo to me"): your guess first, a checked explanation with a diagram, then "In your own words: this works because ___". No file changes.
- **A brainstorm** ("can we brainstorm on caching?"): the AI acts as a senior colleague. You give your ideas first, it stress-tests them with evidence, and you decide with your own reason. The whole brainstorm, every idea and the decision are saved.

Chat is never held. "What does X do?" asks for your guess first, but a quick question while it waits goes ahead. You can always reply "skip" or "not yet"; both are logged, never locked.

## How Copilot differs from Claude Code

- Copilot ignores what a hook returns when you send a message, so skarp gives the AI its rules when the session starts (on VS Code 1.143 that comes after your first message) and enforces them by refusing tools and sending replies back.
- Copilot shows one question per card, so set your level by writing `level beginner` (or `intermediate`, `advanced`) in a message.
- On VS Code 1.143, Copilot doesn't show skarp's end-of-task messages; run `npx skarp-copilot status` to see the last check and grade.
- When skarp sends the AI back, Copilot passes skarp's note to the AI as a chat message, so you may see it in the chat.

## Your data

Everything stays on your machine in `~/.skarp`: the ledger, saved reports and explanations, brainstorms, open work and your level. No account, no network, no telemetry.

## Known gaps

- Copilot's tool names and shapes change between releases, so skarp may miss a new file-writing tool.
- Whether hooks run in Copilot's Ask mode isn't documented; `npx skarp-copilot status` shows whether they did.
- The grade is word matching, and the checks are on shape and wording, not truth.
- If the hook breaks, skarp never blocks the agent; it carries on.

## License

MIT
