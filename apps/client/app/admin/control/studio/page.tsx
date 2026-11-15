"use client";
import Link from "next/link";
import { CampaignList } from "../_components/campaign-list";
import { Heading } from "../_components/ui";

export default function StudioPage() {
  return (
    <>
      <Heading eyebrow="MOMENT STUDIO / DRAFTS & APPROVALS" title="From archive moment to card set.">
        <Link className="cr-btn" href="/admin/control/kam">Find a moment in KAM →</Link>
      </Heading>
      <p className="cr-lede">Drafts are grounded in the archive entry: card lore uses the moment&apos;s own sentences, names are checked against every existing card for duplicates, and nothing launches until someone confirms rights and approves it.</p>
      <CampaignList
        statuses={["draft", "pending_approval", "rejected"]}
        empty={<><h2>No drafts in the studio.</h2><p className="cr-muted">Pick a ranked opportunity in KAM Intelligence and choose “Draft campaign”.</p></>}
      />
    </>
  );
}
