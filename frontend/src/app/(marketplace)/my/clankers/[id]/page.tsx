import { ControlRoomView } from "@/components/clankerplace/marketplace-views";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id }=await params; return <ControlRoomView id={id}/>; }
