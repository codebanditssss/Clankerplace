"use client";

import { ArrowRight, ExternalLink } from "lucide-react";
import type { Connector } from "@/lib/connectors";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BrandIcon, connectorBrand } from "@/components/brand-icon";

type ConnectorStatus = { configured: boolean; running: boolean };

export default function OAuthHandoffCard({
  connector,
  status,
  onSwitchToConsole,
}: {
  connector: Connector;
  status?: ConnectorStatus;
  onSwitchToConsole: () => void;
}) {
  const tone = status?.running ? "green" : status?.configured ? "amber" : "purple";
  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-8 w-8 flex-none items-center justify-center border border-[color:var(--border)] bg-[color:var(--bg-3)]">
            <BrandIcon slug={connectorBrand(connector.slug)} size={16} />
          </div>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold tracking-tight">
              {connector.label}
            </div>
            <p className="mt-0.5 text-[12px] text-[color:var(--text-tertiary)]">
              {connector.blurb}
            </p>
          </div>
        </div>
        <Badge tone={tone}>
          {status?.running
            ? "running"
            : status?.configured
              ? "paired"
              : "needs terminal"}
        </Badge>
      </CardHeader>
      <CardBody>
        <p className="text-[12px] leading-relaxed text-[color:var(--text-tertiary)]">
          {connector.setupHint ?? "Run the OAuth flow from inside the pod console."}
        </p>
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={onSwitchToConsole}>
            Open console <ArrowRight className="h-3 w-3" />
          </Button>
          {connector.docs && (
            <a
              href={connector.docs}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-[color:var(--text-tertiary)] hover:text-[color:var(--text-secondary)]"
            >
              docs <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
