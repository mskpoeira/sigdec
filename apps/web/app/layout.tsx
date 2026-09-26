import "./globals.css";
import PwaRegister from "./PwaRegister";
import GlobalExperience from "./GlobalExperience";

export const metadata = {
  title: "SIGDEC",
  description: "Sistema Integrado de Gestão da Defesa Civil",
  manifest: "/manifest.webmanifest",
  applicationName: "SIGDEC",
  appleWebApp: { capable: true, title: "SIGDEC", statusBarStyle: "default" as const }
};

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="pt-BR"><body><PwaRegister/><GlobalExperience/>{children}</body></html>;
}
