"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import MapView from "@/components/MapView";

export default function TypedMapPage() {
  const { type } = useParams<{ type: string }>();
  return (
    <Suspense fallback={null}>
      <MapView spotTypeKey={type} />
    </Suspense>
  );
}
