import { notFound } from "next/navigation";
import { Suspense } from "react";
import { canViewSpotType } from "@/lib/spot-type-access";
import SpotsView from "@/components/SpotsView";

export default async function TypedSpotsPage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  if (!(await canViewSpotType(type))) notFound();

  // SpotsViewは ?region= を読む(useSearchParams)ので、地図と同じくSuspenseで包む
  return (
    <Suspense fallback={null}>
      <SpotsView spotTypeKey={type} />
    </Suspense>
  );
}
