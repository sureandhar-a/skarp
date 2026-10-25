import type { ButtonHTMLAttributes } from "react";

// Wireframe look: outlined; the main action is accent, destructive is danger.
const styles = {
  normal: "border border-accent text-accent",
  quiet: "border border-border text-text",
  danger: "border border-danger text-danger",
} as const;

export function Button({
  variant = "normal",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof styles }) {
  return (
    <button
      type="button"
      className={`cursor-pointer rounded-control bg-transparent px-2.5 py-0.5 text-small disabled:cursor-default disabled:opacity-50 ${styles[variant]} ${className}`}
      {...props}
    />
  );
}
