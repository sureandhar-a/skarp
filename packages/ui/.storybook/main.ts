import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";

// every kit component in every state and theme, outside the extension.
const config: StorybookConfig = {
  stories: ["../src/**/*.stories.tsx"],
  framework: "@storybook/react-vite",
  core: { disableTelemetry: true },
  viteFinal: (c) => ({ ...c, plugins: [...(c.plugins ?? []), tailwindcss()] }),
};
export default config;
