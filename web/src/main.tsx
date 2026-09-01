import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppGate } from "./AppGate";
import { LanguageProvider } from "./i18n/LanguageContext";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LanguageProvider>
      <AppGate />
    </LanguageProvider>
  </StrictMode>
);
