"use client";

import { useEffect } from "react";
import { useTranslation } from "react-i18next";

export default function HtmlLang() {
  const { i18n } = useTranslation();

  useEffect(() => {
    if (typeof document !== "undefined" && i18n.language) {
      document.documentElement.lang = i18n.language;
    }
  }, [i18n.language]);

  return null;
}
