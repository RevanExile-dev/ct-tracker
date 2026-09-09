import type { Metadata } from "next";
import CosmosExperience from "./CosmosExperience";

export const metadata: Metadata = {
  title: "Cosmos Lab",
  description: "Un esperimento immersivo di Carta Viva alimentato da WebGPU.",
};

export default function CosmosPage() {
  return <CosmosExperience />;
}
