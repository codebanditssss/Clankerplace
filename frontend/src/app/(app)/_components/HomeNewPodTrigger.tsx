"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Dispatches a window-level event that the AppShell-mounted DeployWizard
 * listens for. Avoids prop drilling through server components.
 */
export default function HomeNewPodTrigger({
  asChild,
  children,
}: {
  asChild?: boolean;
  children?: React.ReactNode;
}) {
  const open = () => {
    window.dispatchEvent(new CustomEvent("pods:open-wizard"));
  };
  if (asChild) {
    return (
      <button type="button" onClick={open} className="w-full text-left">
        {children}
      </button>
    );
  }
  return (
    <Button variant="primary" size="md" onClick={open}>
      <Plus className="h-3.5 w-3.5" /> New pod
    </Button>
  );
}
