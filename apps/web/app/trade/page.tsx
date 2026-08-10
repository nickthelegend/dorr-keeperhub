import TradingTerminal from "@/components/trading/terminal";
import { AppShell } from "@/components/app-shell";

export const metadata = {
  title: "Terminal",
};

export default function TradingPage() {
  return (
    <AppShell>
      <TradingTerminal />
    </AppShell>
  );
}
