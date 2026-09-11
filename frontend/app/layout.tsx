import type { Metadata } from "next";
import Nav from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kuhn Poker Nash Equilibrium Solver",
  description:
    "Counterfactual Regret Minimization applied to Kuhn poker, verified against the game's known closed-form solution.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
