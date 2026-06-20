import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import ptBR from "./locales/pt-BR.json";
import es from "./locales/es.json";

const DETECTION_OPTIONS = {
  order: ["localStorage", "navigator"],
  lookupLocalStorage: "vrp_locale",
  caches: ["localStorage"],
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      "pt-BR": { translation: ptBR },
      es: { translation: es },
    },
    fallbackLng: "pt-BR",
    defaultNS: "translation",
    interpolation: {
      escapeValue: false,
    },
    detection: DETECTION_OPTIONS,
    returnObjects: false,
  });

export default i18n;
