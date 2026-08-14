"use client";
import { AuthProvider } from "@/lib/auth";
import { I18nProvider } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme";
import { ToastProvider } from "@/lib/toast";
import { DeleteUndoProvider } from "@/lib/deleteUndo";
import { CurrencyProvider } from "@/lib/currency";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ThemeProvider>
        <I18nProvider>
          <CurrencyProvider>
            <ToastProvider>
              <DeleteUndoProvider>{children}</DeleteUndoProvider>
            </ToastProvider>
          </CurrencyProvider>
        </I18nProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}
