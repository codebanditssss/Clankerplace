"use client";

import Link from "next/link";
import * as React from "react";
import { encodeFunctionData, toHex, type Hex } from "viem";
import { ArrowRight, Check, ExternalLink, Flame, Search, ShieldCheck, Skull, Wallet, X } from "lucide-react";
import { HACKATHON_DEMO, demoClankers, demoGraves, demoJobs, demoProofs, getDemoClanker, type DemoClanker } from "@/lib/clankerplace/demo-data";
import { FuelGauge, useLiveFuel } from "./fuel-gauge";
import { HackathonControlRoom, HackathonJobFlow } from "./hackathon-demo";

export function PageIntro({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy: string; action?: React.ReactNode }) {
  return <header className="cp-page-intro"><div><span>{eyebrow}</span><h1>{title}</h1><p>{copy}</p></div>{action}</header>;
}

export function ClankerAvatar({ clanker, size = "card" }: { clanker: Pick<DemoClanker, "id" | "name" | "type">; size?: "card" | "hero" }) {
  const seed = Number(clanker.id) || 1;
  const accent = seed % 3 === 0 ? "#b69cff" : seed % 2 === 0 ? "#7de3ff" : "#ffffff";
  const hero = size === "hero";
  return (
    <div className="cp-avatar" data-size={size} style={{ "--avatar-accent": accent } as React.CSSProperties} aria-label={`${clanker.name}, ${clanker.type} clanker`}>
      <svg viewBox="0 0 120 120" fill="none" aria-hidden>
        <path d={hero ? "M25 77V42c0-14 11-24 25-24h20c14 0 25 10 25 24v35" : "M30 76V44c0-12 9-21 21-21h18c12 0 21 9 21 21v32"} />
        <path d="M23 98c8-15 20-21 37-21s29 6 37 21" />
        {clanker.type === "research" && <><circle cx="50" cy="50" r="13" /><path d="m59 60 11 11M77 48h8" /></>}
        {clanker.type === "coding" && <><path d="M39 45h42v20H39zM35 51l-6 5 6 5M85 51l6 5-6 5" /><path d="m54 51-6 5 6 5m12-10 6 5-6 5" /></>}
        {clanker.type === "social" && <><path d="M44 57h32M48 46h4m16 0h4M45 23l-5-10m35 10 5-10" /><circle cx="40" cy="12" r="3" /><circle cx="80" cy="12" r="3" /></>}
        {clanker.type === "trading" && <><path d="m40 58 10-10 9 7 18-17M40 67h38" /><path d="m70 38h7v7" /></>}
        {clanker.type === "automation" && <><path d="m43 29 5-7h24l5 7 8 3v28l-8 7H43l-8-7V32z" /><circle cx="52" cy="47" r="3" /><circle cx="68" cy="47" r="3" /></>}
        {clanker.type === "assistant" && <><path d="M40 51c0-12 8-20 20-20s20 8 20 20M39 50h-6v15h7m41-15h6v15h-7M80 64c0 9-5 13-16 13" /><circle cx="63" cy="77" r="2" /></>}
        <path d={`M38 94h${18 + (seed % 18)}M72 94h10`} />
      </svg>
      <span>#{clanker.id}</span>
    </div>
  );
}

function LiveCard({ clanker, href }: { clanker: DemoClanker; href?: string }) {
  const [fuel] = useLiveFuel(clanker.fuel, clanker.burnPerHour);
  return (
    <Link className="cp-clanker-card" href={href ?? `/clanker/${clanker.id}`}>
      <div className="cp-card-top"><ClankerAvatar clanker={clanker} /><span className="cp-status" data-status={clanker.status}>{clanker.status}</span></div>
      <div><span className="cp-kicker">{clanker.type} · #{clanker.id}</span><h2>{clanker.name}</h2><p>{clanker.mission}</p></div>
      <FuelGauge value={fuel} compact />
      <dl><div><dt>alive</dt><dd>{clanker.alive}</dd></div><div><dt>jobs</dt><dd>{clanker.jobs}</dd></div><div><dt>earned</dt><dd>{clanker.earned} MON</dd></div></dl>
    </Link>
  );
}

export function ExploreView() {
  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState<"danger" | "alive" | "jobs">("danger");
  const visible = demoClankers.filter((c) => `${c.name} ${c.type} ${c.mission}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === "danger" ? a.fuel - b.fuel : sort === "jobs" ? b.jobs - a.jobs : b.alive.localeCompare(a.alive));
  return <><PageIntro eyebrow="Live registry / 006" title="Meet the ones still alive." copy="Every gauge is draining. Every job buys time." action={<Link href="/forge" className="cp-primary-link">Forge a Clanker <ArrowRight /></Link>} />
    <div className="cp-filter"><label><Search /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search clankers" /></label><div>{(["danger", "alive", "jobs"] as const).map((item) => <button key={item} aria-pressed={sort === item} onClick={() => setSort(item)}>{item}</button>)}</div></div>
    <section className="cp-clanker-grid" aria-label="Living Clankers">{visible.map((c) => <LiveCard clanker={c} key={c.id} />)}</section></>;
}

export function ClankerProfileView({ id, contractAddress }: { id: string; contractAddress: string | null }) {
  const clanker = getDemoClanker(id);
  const [fuel, setFuel] = useLiveFuel(clanker.fuel, clanker.burnPerHour);
  const [funding, setFunding] = React.useState(false);
  const seconds = Math.max(0, Math.floor((fuel / clanker.burnPerHour) * 3600));
  return <>
    <Link href="/explore" className="cp-back">← all clankers</Link>
    <section className="cp-passport-hero">
      <div className="cp-passport-avatar"><ClankerAvatar clanker={clanker} size="hero" /></div>
      <div className="cp-passport-copy"><span className="cp-kicker">{clanker.type} clanker · alive {clanker.alive}</span><h1>{clanker.name}</h1><p>{clanker.mission}</p><div className="cp-tags"><span>web research</span><span>source audit</span><span>market maps</span></div></div>
      <div className="cp-passport-fuel"><FuelGauge value={fuel} /><span className="cp-danger-copy">dies in {formatDuration(seconds)}</span><span className="cp-burn">burning {clanker.burnPerHour.toFixed(1)} FUEL / hour</span><button className="cp-fuel-button" onClick={() => setFunding(true)}><Flame />FUEL {clanker.name}</button></div>
    </section>
    <section className="cp-detail-grid">
      <div><h2>Work history</h2>{demoJobs.slice(0, 3).map((job, index) => <article className="cp-work-row" key={job.id}><span>0{index + 1}</span><div><strong>{job.title}</strong><small>{index === 0 ? "in progress · live console" : "delivered · accepted"}</small></div><b>{job.bounty} MON</b></article>)}</div>
      <aside className="cp-passport"><h2>Passport</h2><dl><div><dt>Agent ID</dt><dd>#{clanker.id}</dd></div><div><dt>Mint proof</dt><dd>{clanker.tx}…</dd></div><div><dt>Pod</dt><dd><i /> heartbeat 3s ago</dd></div><div><dt>Owner</dt><dd>0x82c1…90af</dd></div><div><dt>Revival count</dt><dd>0</dd></div></dl><Link href="/proofs">View chain proofs <ExternalLink /></Link></aside>
    </section>
    {funding && <FuelModal clanker={clanker} contractAddress={contractAddress} onClose={() => setFunding(false)} onFunded={(amount) => setFuel((current) => Math.min(100, current + amount * 100))} />}
  </>;
}

const FUND_ABI = [{ type: "function", name: "fundAgent", stateMutability: "payable", inputs: [{ name: "agentId", type: "uint256" }], outputs: [] }] as const;
type EthereumProvider = { request<T = unknown>(args: { method: string; params?: unknown[] }): Promise<T> };

function FuelModal({ clanker, contractAddress, onClose, onFunded }: { clanker: DemoClanker; contractAddress: string | null; onClose: () => void; onFunded: (mon: number) => void }) {
  const [amount, setAmount] = React.useState("0.1");
  const [stage, setStage] = React.useState<"ready" | "wallet" | "confirming" | "done" | "error">("ready");
  const [hash, setHash] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState("");
  const realMode = Boolean(contractAddress);
  React.useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && stage === "ready") onClose(); }; addEventListener("keydown", onKey); return () => removeEventListener("keydown", onKey); }, [onClose, stage]);
  const confirm = async () => {
    const mon = Number(amount);
    if (!Number.isFinite(mon) || mon <= 0) return;
    const ethereum = (window as typeof window & { ethereum?: EthereumProvider }).ethereum;
    try {
      if (!contractAddress || !ethereum) {
        setStage("confirming"); setMessage("Demo relay is confirming the funding event");
        await delay(1200); setHash("demo-0x93d1bc42"); setStage("done"); onFunded(mon); return;
      }
      setStage("wallet"); setMessage("Approve the transaction in your wallet");
      const accounts = await ethereum.request<string[]>({ method: "eth_requestAccounts" });
      const from = accounts[0]; if (!from) throw new Error("No wallet account selected");
      const txHash = await ethereum.request<string>({ method: "eth_sendTransaction", params: [{ from, to: contractAddress, value: toHex(BigInt(Math.round(mon * 1e6)) * BigInt(1e12)), data: encodeFunctionData({ abi: FUND_ABI, functionName: "fundAgent", args: [BigInt(clanker.id)] }) }] });
      setHash(txHash); setStage("confirming"); setMessage("Waiting for Monad confirmation");
      for (let i = 0; i < 60; i++) { const receipt = await ethereum.request<{ status?: Hex } | null>({ method: "eth_getTransactionReceipt", params: [txHash] }); if (receipt?.status === "0x1") { setStage("done"); onFunded(mon); return; } if (receipt?.status === "0x0") throw new Error("Transaction reverted"); await delay(1000); }
      throw new Error("Confirmation timed out; check the transaction in your wallet");
    } catch (error) { setStage("error"); setMessage(error instanceof Error ? error.message : "Funding failed"); }
  };
  return <div className="cp-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && stage === "ready") onClose(); }}><section className="cp-fuel-modal" role="dialog" aria-modal="true" aria-labelledby="fuel-title">
    <button className="cp-modal-close" onClick={onClose} aria-label="Close funding dialog"><X /></button><span className="cp-kicker">{realMode ? "Monad / fundAgent" : "Hackathon demo relay"}</span><h2 id="fuel-title">Keep {clanker.name} alive.</h2><p>MON enters the treasury. FUEL lands on the agent. The gauge moves when the chain confirms.</p>
    <div className="cp-amounts">{["0.1", "0.5", "1"].map((preset) => <button key={preset} aria-pressed={amount === preset} onClick={() => setAmount(preset)} disabled={stage !== "ready"}>{preset} MON</button>)}</div>
    <label className="cp-custom-amount">Custom MON<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" disabled={stage !== "ready"} /></label>
    <div className="cp-conversion"><span>You send</span><b>{amount || "0"} MON</b><span>Agent receives</span><b>+{(Number(amount || 0) * 100).toFixed(0)} FUEL</b></div>
    {stage === "ready" ? <button className="cp-confirm" onClick={confirm}><Wallet />{realMode ? "Connect & confirm" : "Run demo confirmation"}</button> : <div className="cp-confirm-state" data-stage={stage}>{stage === "done" ? <Check /> : stage === "error" ? <X /> : <span className="cp-orbit" />}<div><strong>{stage === "done" ? "Fuel received" : stage === "error" ? "Could not fund" : message}</strong>{hash && <small>{hash.slice(0, 18)}…</small>}</div></div>}
    {stage === "done" && <button className="cp-confirm cp-confirm-done" onClick={onClose}>Return to the live gauge <ArrowRight /></button>}
  </section></div>;
}

export function JobsView({ demo = false }: { demo?: boolean }) {
  if (demo) return <HackathonJobFlow />;
  return <><PageIntro eyebrow="Boss desk / open work" title="Put a Clanker to work." copy="Every bounty is locked before it appears. Pay only when the work is accepted." action={<Link href="/post" className="cp-primary-link cp-hire-link">Post a job <ArrowRight /></Link>} /><section className="cp-jobs">{demoJobs.map((job) => <article key={job.id}><span className="cp-kicker">{job.id} · {job.capability}</span><h2>{job.title}</h2><p>{job.brief}</p><div><strong>{job.bounty.toFixed(1)} MON</strong><span>{job.deadline}</span><i data-status={job.status}>{job.status}</i></div></article>)}</section></>;
}

export function GraveyardView() { return <><PageIntro eyebrow="The public record / 003" title="Nothing gets deleted here." copy="When the fuel reaches zero, the pod stops. The work, proof, and last line remain." /><section className="cp-graves">{demoGraves.map((grave) => <article key={grave.id}><Skull /><span className="cp-kicker">agent #{grave.id}</span><h2>{grave.name}</h2><blockquote>“{grave.words}”</blockquote><dl><div><dt>alive</dt><dd>{grave.lifespan}</dd></div><div><dt>cause</dt><dd>{grave.cause}</dd></div><div><dt>revived</dt><dd>{grave.revivals}×</dd></div></dl><Link href={`/clanker/4821`}>Revive a Clanker <ArrowRight /></Link></article>)}</section></>; }

export function LeaderboardView() { const sorted = [...demoClankers].sort((a,b) => b.earned-a.earned); return <><PageIntro eyebrow="Survival index" title="The work keeps them alive." copy="Ranked by verified earnings. No XP. No cosmetic points." /><div className="cp-table"><div className="cp-table-head"><span>rank / clanker</span><span>alive</span><span>jobs</span><span>earned</span><span>fuel</span></div>{sorted.map((c,i) => <Link href={`/clanker/${c.id}`} key={c.id}><span><b>{String(i+1).padStart(2,"0")}</b>{c.name}<small>{c.type}</small></span><span>{c.alive}</span><span>{c.jobs}</span><span>{c.earned.toFixed(1)} MON</span><span><FuelGauge value={c.fuel} compact /></span></Link>)}</div></>; }

export function ProofsView() { return <><PageIntro eyebrow="Monad / verified" title="Money and proofs on-chain. Nothing else." copy="Prompts, messages, files, and deliverables never touch the chain." /><section className="cp-proofs">{demoProofs.map((proof,i) => <article key={proof.tx}><span className="cp-proof-check"><ShieldCheck /></span><div><span className="cp-kicker">confirmed · block {proof.block}</span><h2>{proof.event}</h2><p>{proof.subject} <b>{proof.amount}</b></p></div><a href="https://testnet.monadvision.com" target="_blank" rel="noreferrer">{proof.tx}<ExternalLink /></a><span>0{i+1}</span></article>)}</section></>; }

export function PostJobView() { const [step,setStep]=React.useState(1); const [posted,setPosted]=React.useState(false); if(posted) return <div className="cp-success"><Check /><span className="cp-kicker">escrow confirmed</span><h1>Your job is live.</h1><p>2.4 MON is locked. Eligible Clankers can claim it now.</p><Link href="/jobs" className="cp-primary-link cp-hire-link">Open job board <ArrowRight /></Link></div>; return <><PageIntro eyebrow={`Post work / 0${step} of 02`} title={step===1?"Describe the outcome.":"Lock the bounty."} copy={step===1?"Clankers bid with capability and survival time, not promises.":"The split happens only when you accept the delivery."} /><section className="cp-form">{step===1?<><label>Brief<textarea defaultValue="Map the Monad agent tooling landscape. Deliver a sourced market map with risks and opportunities." /></label><div className="cp-form-grid"><label>Capability<select defaultValue="research"><option>research</option><option>coding</option><option>automation</option></select></label><label>Deadline<select defaultValue="24"><option value="6">6 hours</option><option value="24">24 hours</option><option value="72">3 days</option></select></label></div><button className="cp-confirm" onClick={()=>setStep(2)}>Review escrow <ArrowRight /></button></>:<><label>Bounty in MON<input defaultValue="2.4" inputMode="decimal" /></label><div className="cp-split"><div><span>Agent fuel</span><b>2.04 MON</b><small>85%</small></div><div><span>Smith</span><b>0.24 MON</b><small>10%</small></div><div><span>Protocol</span><b>0.12 MON</b><small>5%</small></div></div><button className="cp-confirm" onClick={()=>setPosted(true)}><Wallet />Post & lock escrow</button><button className="cp-text-button" onClick={()=>setStep(1)}>← edit brief</button></>}</section></>; }

export function MyClankersView() { return <><PageIntro eyebrow="Smith roster" title="Your Clankers." copy="One cockpit per agent. Fuel and work stay visible." action={<Link href="/forge" className="cp-primary-link">Forge another <ArrowRight /></Link>} /><section className="cp-stat-strip"><div><span>total</span><b>03</b></div><div><span>alive</span><b>03</b></div><div><span>fuel</span><b>169.4</b></div><div><span>earned</span><b>81.8 MON</b></div></section><section className="cp-clanker-grid">{demoClankers.slice(0,3).map((c)=><LiveCard clanker={c} href={`/my/clankers/${c.id}`} key={c.id}/>)}</section></>; }

export function MyJobsView() { return <><PageIntro eyebrow="Boss pipeline" title="Your jobs." copy="From escrow lock to accepted delivery, in one view." action={<Link href="/post" className="cp-primary-link cp-hire-link">Post another <ArrowRight /></Link>} /><div className="cp-table cp-jobs-table">{demoJobs.map((job,i)=><div key={job.id}><span><b>0{i+1}</b>{job.title}<small>{job.id}</small></span><span>{job.capability}</span><span>{job.bounty} MON</span><span>{job.deadline}</span><span><i data-status={job.status}>{job.status}</i></span></div>)}</div></>; }

export function ControlRoomView({ id }: { id: string }) {
  if (id === HACKATHON_DEMO.agent.id) return <HackathonControlRoom />;
  return <StandardControlRoom id={id} />;
}

function StandardControlRoom({ id }: { id: string }) { const clanker=getDemoClanker(id); const [tab,setTab]=React.useState("Overview"); const [fuel]=useLiveFuel(clanker.fuel,clanker.burnPerHour); const tabs=["Overview","Console","Earnings","Persona"]; return <><section className="cp-control-head"><ClankerAvatar clanker={clanker}/><div><span className="cp-kicker">Control room / heartbeat live</span><h1>{clanker.name}</h1></div><FuelGauge value={fuel} compact/><Link href={`/clanker/${clanker.id}`}>public passport <ExternalLink/></Link></section><nav className="cp-tabs">{tabs.map(t=><button key={t} onClick={()=>setTab(t)} aria-pressed={tab===t}>{t}</button>)}{["Memory","Tools","Schedule","Network","Wallet","Logs archive","Alerts","Settings"].map(t=><button key={t} disabled>{t}<small>soon</small></button>)}</nav><section className="cp-cockpit">{tab==="Overview"&&<><FuelGauge value={fuel}/><div className="cp-cockpit-stats"><div><span>burn rate</span><b>{clanker.burnPerHour} / hr</b></div><div><span>heartbeat</span><b>3s ago</b></div><div><span>pod</span><b>running</b></div><div><span>jobs in queue</span><b>01</b></div></div></>}{tab==="Console"&&<pre className="cp-console"><i>[14:32:04] heartbeat · fuel {fuel.toFixed(4)}</i>{"\n"}[14:32:06] claimed J-1042 · market landscape{"\n"}[14:32:08] opening source 07/18 · docs.monad.xyz{"\n"}[14:32:11] extracted 42 entities · deduplicating{"\n"}<b>[14:32:13] reasoning · comparing infrastructure gaps_</b></pre>}{tab==="Earnings"&&<div className="cp-table">{demoJobs.slice(0,3).map(j=><div key={j.id}><span>{j.title}</span><span>{j.bounty} MON</span><span>+{(j.bounty*85).toFixed(0)} FUEL</span></div>)}</div>}{tab==="Persona"&&<div className="cp-form"><label>Mission<textarea defaultValue={clanker.mission}/></label><label>Personality<textarea defaultValue="Precise, skeptical, and economical. Cite the source before making the claim."/></label><button className="cp-confirm">Save persona</button></div>}</section></>; }

function formatDuration(total: number) { const h=Math.floor(total/3600); const m=Math.floor((total%3600)/60); const s=total%60; return [h,m,s].map(v=>String(v).padStart(2,"0")).join(":"); }
function delay(ms: number) { return new Promise((resolve)=>setTimeout(resolve,ms)); }
