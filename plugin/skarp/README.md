# skarp for Claude Code and Copilot (preview)

**Own what you ship.** skarp enforces "think first" with hooks and checks the AI's work in code. It doesn't just ask the AI nicely.

## What it does

skarp picks one of three ways of working from your message.

### A task: "fix the login bug", "add a logout button"

1. **Asks before the AI starts.** skarp holds the task and asks one question, such as "Where do you think the bug is?". The options are fixed hints from skarp, never the AI's guesses, and free text always works. A card with the AI's own options or reworded question is refused. Bugs also get "What would show it's fixed?". Your task is saved, so you don't retype it.
2. **Keeps the task open until it's done.** "Still failing" continues the same task: no new question. While the fix isn't finished, the AI ends with a short status (found so far, tried, next step) instead of the report. Saying "fixed" or "works now" asks for the report.
3. **Grades your plan once, at the end.** skarp compares your answer with every file the task changed. You get "your plan matched the change" or "the change went where your plan didn't: …". Never "correct". There's no file limit.
4. **Ends with a checked report** under `## skarp: what changed`: Changes, How it works, New ideas, Diagram, Tests and checks, Check by hand. skarp checks that every section is there, that there's no praise, that nothing claims a change the files don't contain, and that "tests pass" appears only if a test really ran and passed. If a check fails, the AI is sent back once.

### An explanation: "explain the repo to me", "how does the cache work?"

1. **Your guess first:** "What do you think it does now, and which part matters most to you?"
2. **A checked explanation** under `## skarp: explained`: Big picture, Diagram, Key pieces, How a request flows, New ideas, Where to start reading, Your guess vs the code, Your turn.
3. **Your turn:** it ends with "In your own words: this works because ___". Your answer is logged, and the AI says what matches the code and what's missing.
4. No file changes; say "build it" to turn it into a task.

### A brainstorm: "can we brainstorm on caching?", "I have a rough idea: …"

The AI acts as a senior colleague who asks questions and stress-tests your ideas, built on the research in the [main README](../../README.md#brainstorm).

1. **You first.** Your idea comes before any of the AI's ideas. Say "your ideas first" to skip (logged).
2. **Quiet while you list.** The AI only acknowledges and asks "anything else?" until you say "done".
3. **Stress test.** At most two questions per turn, each quoting your exact words; each idea restated neutrally before it's judged; every verdict (holds / risky / doesn't hold / unknown) backed by evidence. "Great idea" with nothing behind it is sent back.
4. **You decide.** A decision needs at least two options and your reason in your own words. Hard-to-undo topics (schema, auth, payments, deletes) get a pre-mortem first.
5. **Kept.** The whole conversation, every idea (who raised it, for and against, verdict, evidence) and the decision are saved. "Continue the brainstorm on X" brings it back; "build it" starts the decision as a task without asking again.

Chat is never held. "What does X do?" asks for your guess first, but a quick question while it waits goes ahead. You can always reply "skip" or "not yet"; both are logged, never locked.

## Install

### Claude Code

One install covers the terminal (CLI), the Claude desktop app's Code tab and the Claude Code extension in VS Code:

```bash
claude plugin marketplace add sureandhar-a/skarp
```

```bash
claude plugin install skarp@skarp-tools
```

Remove it with `claude plugin uninstall skarp@skarp-tools`. Needs Node 24.2 or newer on your PATH (`node --version`).

### GitHub Copilot in VS Code (experimental)

```bash
npx skarp-copilot setup
```

This copies skarp's hook to `~/.skarp/bin/` and writes one user-level hooks file, `~/.copilot/hooks/skarp.json`, for all your projects. It checks Node first and installs nothing if Node is too old. Then open Copilot Chat in any mode and send `create hello.js that prints hello world`.

If no question appears, your VS Code may use the older Local runtime. In your project, run:

```bash
npx skarp-copilot setup --project
```

This writes `.github/hooks/skarp.json` and switches on `chat.useHooks` in `.vscode/settings.json`, keeping your other settings. Reload VS Code.

To check it, run `npx skarp-copilot status`. It shows what's installed and whether your last task, explanation or brainstorm went through each step, with field names and ✓/✗ only, never what you wrote. Update with `npx skarp-copilot@latest setup`. Remove with `npx skarp-copilot remove` (add `--all` to delete your records too).

How Copilot differs from Claude Code:
- Copilot ignores what a hook returns when you send a message, so skarp gives the AI its rules when the session starts (on VS Code 1.143 that comes after your first message) and enforces them by refusing tools and sending replies back.
- Copilot shows one question per card, so set your level by writing `level beginner` (or another level) in a message.
- On VS Code 1.143, Copilot doesn't show skarp's end-of-task messages; run `npx skarp-copilot status` to see the last check and grade.
- When skarp sends the AI back, Copilot passes skarp's note to the AI as a chat message, so you may see it in the chat.

## What it keeps, and where

Everything stays on your machine in `~/.skarp`, outside your project, so the AI doesn't read it:

- `ledger/hooks.jsonl`: every question, answer, skip, grade and check, with the project folder and task
- `reports/`: every report and explanation, one Markdown file each
- `brainstorms/<id>/`: `log.jsonl` (the whole conversation and every idea) and `summary.md` (ideas, decision, open questions)
- `sessions/`: the open work per session
- `profile.json`: your level

There's no account, no network and no telemetry. To delete everything, remove `~/.skarp` (or run `npx skarp-copilot remove --all`).

## Known gaps in this preview

- **Claude Code, plus Copilot as experimental.** Copilot's tool names and shapes change between releases, so its file detection may miss a new tool. Whether hooks run in Copilot's Ask mode is not documented; `npx skarp-copilot status` shows whether they did.
- **Some file writes through the shell are not seen.** skarp sees the Edit, Write, MultiEdit and NotebookEdit tools, shell redirects and `tee`. `cp`, `mv`, `sed -i` or a script that writes files are not graded.
- **The grade is word matching** between your answer and the changed files, not understanding.
- **Checks are on shape and wording, not truth.** skarp checks sections, quotes, evidence markers and praise. It doesn't check that the AI's verdicts or explanations are right.
- **Telling a follow-up from a new task is a guess:** a message with task words that names a new file, or shares no telling word with the open task, starts a new task. "Actually…" always does.
- **Test results are read from the exit code.** A piped test run (`npm test | tail`) counts as unknown.
- **Parallel tool calls** in one session can race on skarp's state file.
- **Hooks can be turned off** by you or your organisation, and then skarp does nothing.
- **skarp never blocks the agent on its own failure.** If the hook breaks, the agent carries on.
