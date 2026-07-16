import { notFound } from "next/navigation";
import { canViewSpotType } from "@/lib/spot-type-access";
import SpotsView from "@/components/SpotsView";

export default async function TypedSpotsPage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  if (!(await canViewSpotType(type))) notFound();

  return <SpotsView spotTypeKey={type} />;
}
