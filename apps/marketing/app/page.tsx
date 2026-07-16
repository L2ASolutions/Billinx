import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { ProblemSolution } from "@/components/ProblemSolution";
import { Features } from "@/components/Features";
import { HowItWorks } from "@/components/HowItWorks";
import { ComplianceTrust } from "@/components/ComplianceTrust";
import { WaitlistCTA } from "@/components/WaitlistCTA";
import { Footer } from "@/components/Footer";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <ProblemSolution />
        <Features />
        <HowItWorks />
        <ComplianceTrust />
        <WaitlistCTA />
      </main>
      <Footer />
    </>
  );
}
