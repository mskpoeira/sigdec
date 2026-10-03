import "./globals.css";
import "./theme-buttons.css";
import "./modern-ui.css";
import PwaRegister from "./PwaRegister";
import GlobalExperience from "./GlobalExperience";

export const metadata = {
  title: "SIGDEC — Defesa Civil de Ubatuba",
  description: "Sistema Integrado de Gestão da Defesa Civil de Ubatuba",
  manifest: "/manifest.webmanifest",
  applicationName: "SIGDEC Ubatuba",
  icons: { icon: "/branding/defesa-civil-ubatuba.webp" },
  appleWebApp: { capable: true, title: "SIGDEC Ubatuba", statusBarStyle: "default" as const }
};

export const viewport = {
  themeColor: "#082f55"
};

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="pt-BR"><body><PwaRegister/><GlobalExperience/>{children}</body></html>;
}
