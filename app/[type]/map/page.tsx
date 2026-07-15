import { notFound } from "next/navigation";
import { Suspense } from "react";
import { query } from "@/lib/db";
import MapView from "@/components/MapView";

export default async function TypedMapPage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  const { rows } = await query(
    "select 1 from spot_types where key = $1 and enabled",
    [type]
  );
  if (!rows[0]) notFound();

  return (
    <Suspense fallback={null}>
      <MapView spotTypeKey={type} />
    </Suspense>
  );
}
