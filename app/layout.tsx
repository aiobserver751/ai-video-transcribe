import type { Metadata } from "next";
import localFont from "next/font/local";
import { Providers } from "@/components/providers";
import { UserProfileProvider, AppQueryClientProvider } from "@/context/UserProfileContext";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Yarn Scribe - AI Video Transcription",
  description: "Transcribe YouTube videos quickly and easily with AI.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers 
          attribute="class" 
          defaultTheme="system" 
          enableSystem
          disableTransitionOnChange
        >
          <AppQueryClientProvider>
            <UserProfileProvider>
              {children}
              <SonnerToaster richColors closeButton />
            </UserProfileProvider>
          </AppQueryClientProvider>
        </Providers>
      </body>
    </html>
  );
}
