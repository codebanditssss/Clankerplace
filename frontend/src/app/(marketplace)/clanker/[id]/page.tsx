import { ClankerProfileView } from "@/components/clankerplace/marketplace-views";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <ClankerProfileView id={id} contractAddress={process.env.FUELBORN_CONTRACT_ADDRESS ?? null} />; }
