import type { Decorator, Preview } from "@storybook/react-vite";
import "./preview.css";

// Simulates the three host themes of the wireframes. Narrow frame = a real sidebar.
const withTheme: Decorator = (Story, ctx) => (
  <div
    data-theme={ctx.globals.theme}
    className="bg-surface p-4 text-text"
    style={{ minHeight: "100vh" }}
  >
    <div style={{ maxWidth: ctx.parameters.wide ? undefined : 340 }}>
      <Story />
    </div>
  </div>
);

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      description: "Simulated host theme",
      toolbar: {
        title: "Theme",
        icon: "paintbrush",
        items: [
          { value: "dark", title: "Dark" },
          { value: "light", title: "Light" },
          { value: "hc", title: "High contrast" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: "dark" },
  parameters: { layout: "fullscreen", controls: { expanded: true } },
};
export default preview;
