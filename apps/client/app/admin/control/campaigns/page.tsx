"use client";
import { CampaignList } from "../_components/campaign-list";
import { Heading } from "../_components/ui";

export default function CommandPage() {
  return (
    <>
      <Heading eyebrow="CAMPAIGN COMMAND / DROPS" title="Approved, live and finished drops.">
        <span className="cr-live"><i className="cr-pulse" /> Live counts refresh every 5s</span>
      </Heading>
      <p className="cr-lede">Launching publishes through the same admin endpoints the content team uses: new set, cards, pack with published odds, then publish checks. Ending a drop deactivates its pack and retires the set.</p>
      <CampaignList
        statuses={["approved", "live", "ended"]}
        poll={5000}
        empty={<><h2>Nothing approved yet.</h2><p className="cr-muted">Approved campaigns from Moment Studio appear here, ready to launch.</p></>}
      />
    </>
  );
}
