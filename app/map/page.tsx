import { Suspense } from "react";
import MapView from "@/components/MapView";

export default function MapPage() {
  return (
    <Suspense fallback={null}>
      <MapView />
    </Suspense>
  );
}
