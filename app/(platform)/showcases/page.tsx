import { InterviewShowcaseConsole } from "@/features/showcase/interview-showcase-console";

interface InterviewShowcasesPageProps {
  searchParams?: Promise<{
    scenario?: string;
  }>;
}

export default async function InterviewShowcasesPage({
  searchParams,
}: InterviewShowcasesPageProps) {
  const { scenario } = (await searchParams) ?? {};
  return <InterviewShowcaseConsole initialScenarioId={scenario} />;
}
