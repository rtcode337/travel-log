"use client";

import { useParams } from "next/navigation";
import SpotsView from "@/components/SpotsView";

export default function TypedSpotsPage() {
  const { type } = useParams<{ type: string }>();
  return <SpotsView spotTypeKey={type} />;
}
