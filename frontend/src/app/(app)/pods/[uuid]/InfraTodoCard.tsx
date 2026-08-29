"use client";

import { Wrench } from "lucide-react";
import type { Connector } from "@/lib/connectors";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BrandIcon, connectorBrand } from "@/components/brand-icon";

export default function InfraTodoCard({ connector }: { connector: Connector }) {
  return (
    <Card className="opacity-70">
      <CardHeader>
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-8 w-8 flex-none items-center justify-center border border-dashed border-[color:var(--border)] bg-[color:var(--bg-3)]">
            <BrandIcon slug={connectorBrand(connector.slug)} size={16} />
          </div>
          <div>
            <div className="text-[14px] font-semibold tracking-tight">
              {connector.label}
            </div>
            <p className="mt-0.5 text-[12px] text-[color:var(--text-tertiary)]">
              {connector.blurb}
            </p>
          </div>
        </div>
        <Badge tone="neutral">
          <Wrench className="h-3 w-3" />
          infra TODO
        </Badge>
      </CardHeader>
      <CardBody>
        <p className="text-[12px] leading-relaxed text-[color:var(--text-tertiary)]">
          {connector.setupHint}
        </p>
      </CardBody>
    </Card>
  );
}
