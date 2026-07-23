import type { Metadata } from "next";
import { NeonDrift } from "./neon-drift";

export const metadata: Metadata = {
  title: "Neon Drift — The city moves with you.",
  description:
    "A fast, mobile-first arcade runner where you transform the city to survive.",
};

export default function Home() {
  return <NeonDrift />;
}
