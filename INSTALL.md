# Installing skarp

skarp is in preview. These steps cover Claude Code and GitHub Copilot in VS Code.

## Claude Code

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
2. **A walkthrough with one blank.** Claude says where you stand (what exists, what will change) and ends with a sentence to fill in. Fill it (or say "not yet") and Claude writes `hello.js` without you retyping anything.
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

## VS Code

### Claude Code extension

Nothing extra to do: the [Claude Code install](#claude-code) above covers the extension too. Test it with the same [Try it](#try-it) prompt in the extension's chat.

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

To report a problem, type `/flag` in chat, then run `npx skarp-copilot report`. To update, run `npx skarp-copilot@latest setup`. To remove, run `npx skarp-copilot remove`. For how Copilot differs from Claude Code, see the [plugin README](plugin/skarp/README.md#github-copilot-in-vs-code-experimental).

## Feedback and bugs

This is a preview, and your feedback shapes what comes next. Open an [issue](https://github.com/sureandhar-a/skarp/issues) and describe what you ran, what you expected and what happened. The last few lines of `~/.skarp/ledger/hooks.jsonl` help; check them for anything private before you share them.
