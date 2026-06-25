import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "leaflet/dist/leaflet.css";
import I18nProvider from "@/i18n/Provider";
import HtmlLang from "@/i18n/HtmlLang";
import { ToastProvider } from "@/lib/toast";
import ToastHost from "@/components/ToastHost";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Optimizador de Rutas VRP",
  description:
    "Optimización de rutas diarias multi-trayecto con restricciones (Vehicle Routing Problem)",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body className={inter.className}>
        <I18nProvider>
          <HtmlLang />
          <ToastProvider>
            <div className="min-h-screen flex flex-col">{children}</div>
            <ToastHost />
          </ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
