import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
// Fonts are bundled (no web font service: mock mode allows nothing from outside).
import "@fontsource/montserrat/300.css";
import "@fontsource/montserrat/400.css";
import "@fontsource/montserrat/500.css";
import "@fontsource/montserrat/600.css";
import "@fontsource/montserrat/700.css";
import "@fontsource/montserrat/800.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
// The family's shared UI standard first (vendored byte-identical; see scripts/check-ui-standard.sh), then the lab's own layout.
import "./standalone-ui.css";
import "./app.css";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(<App />);
