import { MevShield } from "@/components/mev/mev-shield";

export const metadata = {
  title: "MEV Shield — the private lane, measured",
  description:
    "The same swap run twice on Sepolia — public mempool versus KeeperHub private routing — with the sandwich loss priced in dollars.",
};

export default function MevShieldPage() {
  return <MevShield />;
}
