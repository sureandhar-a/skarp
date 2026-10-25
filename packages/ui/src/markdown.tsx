// Model replies are Markdown. react-markdown builds React elements and drops raw HTML,
// so untrusted model text can't inject markup into the webview.
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  p: (p) => <p className="my-1.5 first:mt-0 last:mb-0" {...p} />,
  h1: (p) => <h3 className="mt-3 mb-1 text-question font-medium" {...p} />,
  h2: (p) => <h3 className="mt-3 mb-1 text-question font-medium" {...p} />,
  h3: (p) => <h4 className="mt-2.5 mb-1 font-medium" {...p} />,
  ul: (p) => <ul className="my-1.5 list-disc pl-5" {...p} />,
  ol: (p) => <ol className="my-1.5 list-decimal pl-5" {...p} />,
  li: (p) => <li className="my-0.5" {...p} />,
  a: (p) => <a className="text-accent underline" {...p} />,
  blockquote: (p) => <blockquote className="my-1.5 border-l-2 border-border pl-2.5" {...p} />,
  // inline code; fenced blocks are styled by the `pre` wrapper below
  code: (p) => (
    <code
      className="rounded-control bg-surface-raised px-1 font-code text-small [pre_&]:bg-transparent [pre_&]:p-0"
      {...p}
    />
  ),
  pre: (p) => (
    <pre
      className="my-2 overflow-x-auto rounded-card border border-border bg-surface-raised px-3 py-2 font-code text-small"
      {...p}
    />
  ),
  table: (p) => (
    <div className="my-2 overflow-x-auto">
      <table className="border-collapse text-small" {...p} />
    </div>
  ),
  th: (p) => <th className="border border-border px-2 py-1 text-left font-medium" {...p} />,
  td: (p) => <td className="border border-border px-2 py-1" {...p} />,
  hr: () => <hr className="my-3 border-border" />,
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="min-w-0 break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
