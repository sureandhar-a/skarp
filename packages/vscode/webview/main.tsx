import { createRoot } from "react-dom/client";
import "./main.css";
import App from "./App";

// Surface rule: render only; all state of record lives in core.
createRoot(document.getElementById("root") as HTMLElement).render(<App />);
