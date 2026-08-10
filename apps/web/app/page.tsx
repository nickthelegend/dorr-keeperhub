import { Landing } from "@/components/landing/landing";

export const metadata = {
  title: "dorr — private perpetual futures on Sepolia",
  description:
    "A perps venue where your order is a commitment, your stops are never published, and PnL settles on chain through KeeperHub rather than on the operator's word.",
};

export default function LandingPage() {
  return <Landing />;
}
