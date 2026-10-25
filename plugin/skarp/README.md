# skarp for Claude Code (preview)

**Own what you ship.** skarp enforces "think first" with hooks and grades your plan against what the AI actually changed. It doesn't just ask the AI nicely.

## What it does

1. **Asks before the AI starts.** When you give Claude Code a task, skarp holds it and asks one question, for example "Which part of the code do you expect this change to touch?". Your task is saved, so you don't retype it. Your answer releases it.
2. **Caps each slice.** The AI may change at most 3 files per task. Writes past that are refused with a reason.
3. **Grades your plan.** When the AI finishes, skarp compares your answer with the files the AI really changed. You get "your plan matched the change" or "the change went where your plan didn't: …". Never "correct".
4. **Ends every task with a checked explanation.** The AI must finish with a `## skarp: what changed` report:
   - Changes
   - How it works
   - New ideas
   - Diagram (plain text)
   - Tests and checks
   - Check by hand

   skarp checks that every section is there, that there's no praise, that nothing claims a change the files don't contain, and that "tests pass" appears only if a test command really ran and passed. If a check fails, the AI is sent back once to fix it. If it still fails, the report is owed on your next message.
5. **Explains at your level.** The first question also asks if you're a beginner, intermediate or advanced. You can change it any time by writing `level advanced` (or another level) in a message.

Chat and quick questions are never held. You can always reply "skip" or "not yet"; both are logged, never locked.

## Install

### Claude Code

One install covers all Claude Code surfaces: the terminal (CLI), the Claude desktop app's Code tab and the Claude Code extension in VS Code. Run these in a terminal:

```bash
claude plugin marketplace add sureandhar-a/skarp
```

```bash
claude plugin install skarp@skarp-tools
```

Remove it with `claude plugin uninstall skarp@skarp-tools`.

Needs Node 24.2 or newer on your PATH (`node --version`). On older Node the hook does nothing.

### VS Code Copilot (experimental)

Copilot agent mode runs the same hook script through a hooks file in your project.

1. Clone this repo somewhere, for example `~/skarp`.
2. In your project, create the hooks file pointing at the script:
   ```bash
   mkdir -p .github/hooks && sed "s#SKARP_HOOK#$HOME/skarp/plugin/skarp/hooks/hook.mjs#" ~/skarp/plugin/skarp/copilot/skarp.json > .github/hooks/skarp.json
   ```
3. Turn on hooks and the question card in the project's `.vscode/settings.json` (VS Code 1.110 or newer):
   ```json
   { "chat.useHooks": true, "chat.askQuestions.enabled": true }
   ```
4. Use Copilot Chat in **Agent** mode.

How it differs from Claude Code:
- skarp's question uses Copilot's own question card. Copilot may reword it (often as a yes/no "May I proceed?") and shows one question per card, so the Level question is not asked there. Set it by writing `level beginner` (or another level) in a message.
- Copilot doesn't pass skarp's notes on your message to the AI. skarp's rules reach it only when a tool is refused, so the report can be missing.
- skarp's end-of-task messages (the grade, "report checked") don't show in Copilot's chat. They are in `~/.skarp/ledger/hooks.jsonl`.
- Copilot can write several files in one patch. skarp counts each file in it (renames count both names) and refuses the whole patch if it goes past the cap.

To remove it, delete `.github/hooks/skarp.json`.

## What it keeps, and where

Everything stays on your machine in `~/.skarp`, outside your project, so the AI doesn't read it:

- `sessions/`: the held task and the files touched, per Claude Code session
- `ledger/hooks.jsonl`: every question, answer, skip, grade and report check, with timestamps
- `profile.json`: your level

There's no account, no network and no telemetry. To delete everything, remove `~/.skarp`.

## Known gaps in this preview

- **Claude Code, plus VS Code Copilot as experimental.** Copilot's tool names and shapes change between releases, so its file detection may miss a new tool. Antigravity and Codex are coming next; see [What's next](../../README.md#whats-next).
- **File writes through the shell** (for example `cat > file`) are not capped or graded. Only the Edit, Write, MultiEdit and NotebookEdit tools are.
- **The grade is word matching** between your answer and the changed files, not understanding. The threshold is a first guess.
- **The report's teaching quality is written by the model and not graded.** skarp checks that the sections are there, in order and not empty, and catches common praise and test claims. It doesn't check how well the report teaches.
- **Test results are read from the exit code.** A test run piped into another command (`npm test | tail`) counts as unknown, so "tests pass" is sent back.
- **The cap counts files, not steps.** If the AI deletes a file in one call and is then refused, the tree can be left half-done for the AI to fix.
- **Parallel tool calls** in one session can race on skarp's state file.
- **Hooks can be turned off** by the user (`disableAllHooks`), and then skarp does nothing.
- **skarp never blocks the agent on its own failure.** If the hook breaks, the agent carries on.
