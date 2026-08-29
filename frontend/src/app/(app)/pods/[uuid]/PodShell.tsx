"use client";

import PodPageClient from "./PodPageClient";

export default function PodShell(props: {
  identifier: string;
  initiallyInstalled: boolean;
  podName: string;
  podTypeSlug: string;
  meta: {
    provider: string;
    model: string;
    memory: number;
    cpu: number;
    disk: number;
  };
}) {
  return <PodPageClient {...props} />;
}
