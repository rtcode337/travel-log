import { notFound } from "next/navigation";
import { Suspense } from "react";
import { canViewSpotType } from "@/lib/spot-type-access";
import MapView from "@/components/MapView";

export default async function TypedMapPage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  if (!(await canViewSpotType(type))) notFound();

  return (
    <Suspense fallback={null}>
      <MapView spotTypeKey={type} />
    </Suspense>
  );
}
