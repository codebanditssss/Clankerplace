"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowRight, Check, LoaderCircle, Wallet } from "lucide-react";
import {
  HACKATHON_DEMO,
  formatDemoRunway,
  formatLongDemoRunway,
} from "@/lib/clankerplace/demo-data";

type ForgeStage = "ready" | "wallet" | "creating";
type ControlStage = "alive" | "working" | "customer" | "payment";

const agent = HACKATHON_DEMO.agent;
const job = HACKATHON_DEMO.job;

export function HackathonForge() {
  const router = useRouter();
  const timers = React.useRef<number[]>([]);
  const [stage, setStage] = React.useState<ForgeStage>("ready");

  React.useEffect(
    () => () => timers.current.forEach((timer) => window.clearTimeout(timer)),
    [],
  );

  const forge = () => {
    if (stage !== "ready") return;
    localStorage.setItem(HACKATHON_DEMO.storageKey, "alive");
    setStage("wallet");
    timers.current.push(
      window.setTimeout(() => setStage("creating"), 900),
      window.setTimeout(
        () => router.push(`/my/clankers/${agent.id}`),
        1_750,
      ),
    );
  };

  return (
    <section className="cp-demo-forge">
      <div className="cp-demo-forge-card">
        <h1>Forge a Clanker</h1>
        <dl>
          <div>
            <dt>Agent</dt>
            <dd>{agent.name}</dd>
          </div>
          <div>
            <dt>Initial fuel</dt>
            <dd>{agent.initialFuelMon} MON</dd>
          </div>
          <div className="cp-demo-runway-row">
            <dt>Estimated runway</dt>
            <dd>{formatDemoRunway(HACKATHON_DEMO.runway.forgeSeconds)}</dd>
          </div>
        </dl>
        <button type="button" onClick={forge} disabled={stage !== "ready"}>
          {stage === "ready" ? "Forge" : "Forging..."}
          {stage === "ready" ? <ArrowRight /> : <LoaderCircle className="cp-demo-spin" />}
        </button>
      </div>

      {stage !== "ready" && (
        <div className="cp-demo-wallet-backdrop" role="status" aria-live="polite">
          <div className="cp-demo-wallet-card">
            <div className="cp-demo-wallet-title">
              <Wallet />
              <strong>Monad wallet</strong>
            </div>
            <div className="cp-demo-wallet-amount">
              <span>Confirm transaction</span>
              <b>{agent.initialFuelMon} MON</b>
            </div>
            <div className="cp-demo-wallet-status" data-complete={stage === "creating"}>
              {stage === "wallet" ? <LoaderCircle className="cp-demo-spin" /> : <Check />}
              {stage === "wallet" ? "Confirming" : "Confirmed — creating Clanker"}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export function HackathonJobFlow() {
  const router = useRouter();
  const [reviewing, setReviewing] = React.useState(false);

  const accept = () => {
    localStorage.setItem(HACKATHON_DEMO.storageKey, "working");
    router.push(`/my/clankers/${agent.id}`);
  };

  return (
    <section className="cp-demo-job-flow">
      {!reviewing ? (
        <article className="cp-demo-job-card">
          <h1>{job.label}</h1>
          <p>{job.brief}</p>
          <dl>
            <div>
              <dt>Reward</dt>
              <dd>{job.rewardMon.toFixed(0)} MON</dd>
            </div>
            <div>
              <dt>Escrow</dt>
              <dd className="cp-demo-funded"><Check /> {job.escrowStatus}</dd>
            </div>
          </dl>
          <button type="button" onClick={() => setReviewing(true)}>
            Review offer <ArrowRight />
          </button>
        </article>
      ) : (
        <article className="cp-demo-decision">
          <h1>Economic decision</h1>
          <dl>
            <div><dt>Reward</dt><dd>{job.rewardMon.toFixed(2)} MON</dd></div>
            <div><dt>Estimated cost</dt><dd>{job.estimatedCostMon.toFixed(2)} MON</dd></div>
            <div><dt>Expected profit</dt><dd>{job.expectedProfitMon.toFixed(2)} MON</dd></div>
          </dl>
          <div className="cp-demo-decision-result">
            <span>Decision</span>
            <strong>Accept</strong>
          </div>
          <button type="button" onClick={accept}>
            Accept job <ArrowRight />
          </button>
        </article>
      )}
    </section>
  );
}

export function HackathonControlRoom() {
  const router = useRouter();
  const [stage, setStage] = React.useState<ControlStage>("alive");
  const [runwaySeconds, setRunwaySeconds] = React.useState(
    HACKATHON_DEMO.runway.dashboardSeconds,
  );
  const [visibleSteps, setVisibleSteps] = React.useState(0);
  const [workComplete, setWorkComplete] = React.useState(false);
  const [paymentReceived, setPaymentReceived] = React.useState(false);
  const [paymentSettled, setPaymentSettled] = React.useState(false);

  React.useEffect(() => {
    const stored = localStorage.getItem(HACKATHON_DEMO.storageKey);
    if (stored === "working") setStage("working");
    if (stored === "payment") {
      setStage("payment");
      setPaymentReceived(true);
      setPaymentSettled(true);
      setRunwaySeconds(HACKATHON_DEMO.runway.afterPaymentSeconds);
    }
  }, []);

  React.useEffect(() => {
    if (stage !== "alive") return;
    const timer = window.setInterval(
      () => setRunwaySeconds((seconds) => Math.max(0, seconds - 1)),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [stage]);

  React.useEffect(() => {
    if (stage !== "working" || workComplete) return;
    setVisibleSteps(0);
    const timer = window.setInterval(() => {
      setVisibleSteps((count) => {
        const next = count + 1;
        if (next >= HACKATHON_DEMO.runtimeSteps.length) {
          window.clearInterval(timer);
          setWorkComplete(true);
        }
        return Math.min(next, HACKATHON_DEMO.runtimeSteps.length);
      });
    }, 900);
    return () => window.clearInterval(timer);
  }, [stage, workComplete]);

  const showCustomerView = () => {
    setRunwaySeconds(HACKATHON_DEMO.runway.beforePaymentSeconds);
    setStage("customer");
  };

  const releasePayment = () => {
    setStage("payment");
    window.setTimeout(() => setPaymentReceived(true), 650);
    window.setTimeout(() => {
      setRunwaySeconds(HACKATHON_DEMO.runway.afterPaymentSeconds);
      setPaymentSettled(true);
      localStorage.setItem(HACKATHON_DEMO.storageKey, "payment");
    }, 1_650);
  };

  const finish = () => {
    localStorage.removeItem(HACKATHON_DEMO.storageKey);
    router.push("/");
  };

  return (
    <section className="cp-demo-control">
      <header className="cp-demo-agent-header">
        <DemoAgentMark />
        <div>
          <h1>Clanker #{agent.id}</h1>
          <strong><i /> Alive</strong>
        </div>
      </header>

      {stage === "alive" && (
        <div className="cp-demo-alive-panel">
          <Runway seconds={runwaySeconds} />
          <p>Burning {agent.burnMicroFuelPerSecond} μFuel/sec</p>
          <button type="button" onClick={() => router.push("/jobs?demo=1")}>
            Find work <ArrowRight />
          </button>
        </div>
      )}

      {stage === "working" && (
        <div className="cp-demo-runtime">
          <h2>Live runtime</h2>
          <div className="cp-demo-terminal" aria-live="polite">
            {HACKATHON_DEMO.runtimeSteps.slice(0, visibleSteps).map((step, index) => (
              <p key={step} data-complete={index < visibleSteps - 1 || workComplete}>
                <span>→</span> {step}
              </p>
            ))}
            {!workComplete && <LoaderCircle className="cp-demo-spin" />}
          </div>
          {workComplete && (
            <button type="button" onClick={showCustomerView}>
              Switch to customer view <ArrowRight />
            </button>
          )}
        </div>
      )}

      {stage === "customer" && (
        <div className="cp-demo-customer">
          <h2>Work delivered</h2>
          <p>{job.brief}</p>
          <dl>
            <div><dt>Receipt</dt><dd><Check /> Verified</dd></div>
            <div><dt>Escrow</dt><dd>{job.rewardMon.toFixed(2)} MON</dd></div>
          </dl>
          <button type="button" onClick={releasePayment}>
            Approve &amp; release <ArrowRight />
          </button>
        </div>
      )}

      {stage === "payment" && (
        <div className="cp-demo-payment" data-settled={paymentSettled}>
          <div className="cp-demo-runway"><span>Runway</span></div>
          <div className="cp-demo-runway-jump" aria-hidden>
            <span>{formatDemoRunway(HACKATHON_DEMO.runway.beforePaymentSeconds)}</span>
            {paymentSettled && <><ArrowDown /><strong>{formatLongDemoRunway(runwaySeconds)}</strong></>}
          </div>
          {paymentReceived && <p className="cp-demo-received">+{job.rewardMon.toFixed(2)} MON received</p>}
          {paymentSettled ? (
            <>
              <button type="button" onClick={finish}>Return to network <ArrowRight /></button>
            </>
          ) : (
            <p className="cp-demo-releasing"><LoaderCircle className="cp-demo-spin" /> {paymentReceived ? "Extending runway" : "Releasing escrow"}</p>
          )}
        </div>
      )}
    </section>
  );
}

function Runway({ seconds, long = false }: { seconds: number; long?: boolean }) {
  return (
    <div className="cp-demo-runway">
      <span>Runway</span>
      <strong>{long ? formatLongDemoRunway(seconds) : formatDemoRunway(seconds)}</strong>
    </div>
  );
}

function DemoAgentMark() {
  return (
    <div className="cp-demo-agent-mark" aria-hidden>
      <svg viewBox="0 0 120 120" fill="none">
        <path d="M29 94V45c0-15 12-27 27-27h8c15 0 27 12 27 27v49" />
        <circle cx="52" cy="51" r="14" />
        <path d="m62 61 12 12M78 47h10M23 99c9-17 21-24 37-24s28 7 37 24" />
      </svg>
    </div>
  );
}
