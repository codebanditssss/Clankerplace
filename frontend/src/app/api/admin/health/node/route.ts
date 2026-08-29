// Per-Wings-node health probe. Reads the node's allocated_resources +
// connection state from Pelican (it's the most direct way to know if
// the daemon is reachable). 200 if Pelican still considers the node
// online and not in maintenance.

import { NextRequest, NextResponse } from "next/server";
import { NotAdminError, requireAdmin } from "@/lib/admin";
import { applicationApi } from "@/lib/pelican";

export const dynamic = "force-dynamic";

type NodeAttrs = {
  id: number;
  name: string;
  maintenance_mode: boolean;
  memory: number;
  allocated_resources: { memory: number };
};

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof NotAdminError) {
      return new NextResponse("not found", { status: 404 });
    }
    throw e;
  }
  const n = Number(req.nextUrl.searchParams.get("n") ?? "");
  if (!Number.isInteger(n) || n <= 0) {
    return NextResponse.json({ ok: false, error: "bad node id" }, { status: 400 });
  }
  try {
    const r = await applicationApi<{ attributes: NodeAttrs }>(`/nodes/${n}`);
    const a = r.attributes;
    return NextResponse.json({
      ok: !a.maintenance_mode,
      maintenance: a.maintenance_mode,
      memory_used: a.allocated_resources.memory,
      memory_total: a.memory,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }
}
