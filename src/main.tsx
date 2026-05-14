import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initI18n } from "@/lib/i18n";

async function bootstrap() {
  // Fetch language configuration from server
  let language = 'de';
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const config = await res.json();
      language = config.language || 'de';
    }
  } catch {
    console.warn('Could not fetch config, using default language');
  }
  
  // Initialize i18n before rendering
  await initI18n(language);
  
  // Render the app
  createRoot(document.getElementById("root")!).render(<App />);
}

bootstrap();
