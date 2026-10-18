"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { messages, preferredLanguage, type Language } from "./messages";
const LocaleContext = createContext<{
  language: Language;
  setLanguage: (value: Language) => void;
  t: typeof messages.en;
} | null>(null);
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, change] = useState<Language>("en");
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("restaurant-language");
    } catch {}
    change(preferredLanguage(saved, navigator.language));
  }, []);
  function setLanguage(value: Language) {
    change(value);
    try {
      localStorage.setItem("restaurant-language", value);
    } catch {}
  }
  return (
    <LocaleContext.Provider
      value={{ language, setLanguage, t: messages[language] }}
    >
      {children}
    </LocaleContext.Provider>
  );
}
export function useLanguage(englishOnly = false) {
  const context = useContext(LocaleContext);
  const language = englishOnly ? "en" : (context?.language ?? "en");
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  if (!context) throw new Error("LanguageProvider required");
  return { ...context, language, t: messages[language] };
}
