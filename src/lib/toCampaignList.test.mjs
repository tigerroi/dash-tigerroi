import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HARDCODED_SUBDOMAIN_CAMPAIGNS,
  getSubdomainHardcodedCampaigns,
  toCampaignList,
  buildCampaignsBySubDomain,
} from "./toCampaignList.js";

test("toCampaignList mengabaikan nilai kosong atau tanpa nama", () => {
  const result = toCampaignList([
    { name: "Campaign A", spend: 100 },
    null,
    { campaign: "Campaign B", spend: 200 },
    {},
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].name, "Campaign A");
  assert.equal(result[1].campaign, "Campaign B");
});

test("getSubdomainHardcodedCampaigns mengembalikan list campaign Meta untuk decor.trayedit.com", () => {
  const campaigns = getSubdomainHardcodedCampaigns("decor.trayedit.com", 480470);
  assert.equal(campaigns.length, 3);
  assert.equal(campaigns[0].name, "4QCP 01 PROS TI+UE CARROU LKM 72 (10 Adset)");
  assert.equal(campaigns[1].name, "4QCP 02 PROS ITALIA CARROU LKM 73 (10 Adset)");
  assert.equal(campaigns[2].name, "ZGFR 01 PROS BIG SIX CARROU LKM 12 (5 Adset)");

  // Total alokasi spend harus tepat 480.470
  const totalSpend = campaigns.reduce((sum, c) => sum + c.spend, 0);
  assert.equal(totalSpend, 480470);
});

test("getSubdomainHardcodedCampaigns mengembalikan list campaign Meta untuk slug pendek decor", () => {
  const campaigns = getSubdomainHardcodedCampaigns("decor", 750000);
  assert.equal(campaigns.length, 3);
  assert.equal(campaigns[0].spend, 350000);
  assert.equal(campaigns[1].spend, 300000);
  assert.equal(campaigns[2].spend, 100000);
});

test("getSubdomainHardcodedCampaigns untuk mod.tiktokmodapk.net", () => {
  const campaigns = getSubdomainHardcodedCampaigns("mod.tiktokmodapk.net", 400000);
  assert.equal(campaigns.length, 2);
  assert.equal(campaigns[0].name, "TS9S 05 PROS ARAB SAUDI CARROU M 25 (10 Adset)");
  assert.equal(campaigns[0].spend, 200000);
  assert.equal(campaigns[1].spend, 200000);
});

test("buildCampaignsBySubDomain memetakan campaigns dari properti campaign maupun name", () => {
  const users = [
    {
      id: "u1",
      campaigns: [
        { campaign: "Custom Camp 1", subDomain: "custom.domain.com", spend: 50000 },
        { name: "Custom Camp 2", subDomain: "custom.domain.com", spend: 30000 },
      ],
    },
  ];

  const map = buildCampaignsBySubDomain(users);
  const list = map.get("custom.domain.com");
  assert.equal(list.length, 2);
  assert.equal(list[0].name, "Custom Camp 1");
  assert.equal(list[1].name, "Custom Camp 2");
});
