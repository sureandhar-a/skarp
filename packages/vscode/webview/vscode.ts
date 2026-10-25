// VS Code allows acquireVsCodeApi() once per webview; both panels share this one.
export const vscode = acquireVsCodeApi();
