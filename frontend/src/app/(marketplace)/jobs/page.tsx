import { JobsView } from "@/components/clankerplace/marketplace-views";
export default async function Page({ searchParams }: { searchParams: Promise<{ demo?: string | string[] }> }) {
  return <JobsView demo={(await searchParams).demo === "1"} />;
}
