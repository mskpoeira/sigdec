import "./globals.css";
import PwaRegister from "./PwaRegister";

export const metadata = {
  title: "SIGDEC",
  description: "SIGDEC — Sistema Integrado de Gestão de Defesa Civil",
  manifest: "/manifest.webmanifest",
  applicationName: "SIGDEC — Defesa Civil",
  appleWebApp: { capable: true, title: "SIGDEC", statusBarStyle: "default" as const }
};

export const viewport = { themeColor: "#0b2f55" };

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="pt-BR"><body><PwaRegister/>{children}</body></html>;
}
