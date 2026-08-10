import { MevShield } from "@/components/mev/mev-shield";
import { AppShell } from "@/components/app-shell";

export const metadata = {
  title: "MEV Shield — the private lane, measured",
  description:
    "The same swap run twice on Sepolia — public mempool versus KeeperHub private routing — with the sandwich loss priced in dollars.",
};

export default function MevShieldPage() {
  return (
    <AppShell>
      <MevShield />
    </AppShell>
  );
}
