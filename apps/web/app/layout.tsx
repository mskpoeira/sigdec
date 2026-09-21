import "./globals.css";

export const metadata = {
  title: "SIGDEC",
  description: "Sistema Integrado de Gestão da Defesa Civil"
};

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
