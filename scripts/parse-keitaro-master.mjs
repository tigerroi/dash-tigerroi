import fs from "node:fs";

const rawData = `
https://appscity.tech/TMkPrHGK?city=[tech]	RHGK	careers.tiktokmodapk.net
https://appscity.tech/k3wbXNZp?city=[tech]	XNZP	insurance.tiktokmodapk.net
https://appscity.tech/nGpHD6R9?city=[tech]	D6R9	rewards.tiktokmodapk.net
https://appscity.tech/dnR9Ts9S?city=[tech]	TS9S	mod.tiktokmodapk.net
https://appscity.tech/67RdzMjj?city=[tech]	ZMJJ	crm.tiktokmodapk.net
https://appscity.tech/76LxZPMh?city=[tech]	ZPMH	cantina.tacobellmenuu.us
https://appscity.tech/FF8hRWLb?city=[tech]	RWLB	burrito.tacobellmenuu.us
https://appscity.tech/WMP6ZVgM?city=[tech]	ZVGM	fries.tacobellmenuu.us
https://appscity.tech/s3RWCb3K?city=[tech]	CB3K	news.tacobellmenuu.us
https://appscity.tech/YcDCdFNQ?city=[tech]	DFNQ	finance.tacobellmenuu.us
https://appscity.tech/rWbj4QcP?city=[tech]	4QCP	decor.trayedit.com
https://appscity.tech/qVjXBWDv?city=[tech]	BWDV	materials.trayedit.com
https://appscity.tech/Dyv6Zgfr?city=[tech]	ZGFR	cabinets.trayedit.com
https://appscity.tech/Wq2f2yVL?city=[tech]	2YVL	guides.trayedit.com
https://appscity.tech/kbRf43tW?city=[tech]	43TW	styling.trayedit.com
https://appscity.tech/tJWYJ7?city=[tech]	WYJ7	menu.ihopmenuwithprices.us
https://appscity.tech/t66q2g?city=[tech]	6Q2G	deals.ihopmenuwithprices.us
https://appscity.tech/rSXvdv?city=[tech]	XVDV	keto.ihopmenuwithprices.us
https://appscity.tech/rHTfWG?city=[tech]	TFWG	hacks.ihopmenuwithprices.us
https://appscity.tech/9gPxZ2?city=[tech]	PXZ2	news.ihopmenuwithprices.us
https://appscity.tech/h1vHdqN2?city=[tech]	DQN2	freelance.workmoney24.com
https://appscity.tech/Hc5g4R2m?city=[tech]	4R2M	skills.workmoney24.com
https://appscity.tech/3rxdx8pJ?city=[tech]	X8PJ	wfh.workmoney24.com
https://appscity.tech/QPTFfGCd?city=[tech]	FGCD	passiveincome.workmoney24.com
https://appscity.tech/zF24KvD1?city=[tech]	KVD1	affiliate.workmoney24.com
https://appscity.tech/Y9trWnjC?city=[tech]	WNJC	finance.uniqueinfo24.com
https://appscity.tech/dZMyG9Sq?city=[tech]	G9SQ	travel.uniqueinfo24.com
https://appscity.tech/gYzdn1bd?city=[tech]	N1BD	health.uniqueinfo24.com
https://appscity.tech/9Qc2245r?city=[tech]	245R	insurance.uniqueinfo24.com
https://appscity.tech/qNSjsBS6?city=[tech]	SBS6	loan.uniqueinfo24.com
https://appscity.tech/qxfhbZp2?city=[tech]	BZP2	weightloss.cmhhealths.com
https://appscity.tech/WGGvj69x?city=[tech]	J69X	diabetes.cmhhealths.com
https://appscity.tech/n67h7kL2?city=[tech]	7KL2	dosage.cmhhealths.com
https://appscity.tech/F1NTTdj6?city=[tech]	TDJ6	injections.cmhhealths.com
https://appscity.tech/RjjyjS43?city=[tech]	JS43	sideeffects.cmhhealths.com
https://appscity.tech/4SrfYnXM?city=[tech]	YNXM	fitness.cmhhealths.com
https://appscity.tech/nhpB2fGp?city=[tech]	2FGP	Family.ziperto.org
https://appscity.tech/pj9ST7pv?city=[tech]	T7PV	Gaming.ziperto.org
https://appscity.tech/kT8j4c9L?city=[tech]	4C9L	Guides.ziperto.org
https://appscity.tech/Ddh9PshM?city=[tech]	PSHM	Hard.ziperto.org
https://appscity.tech/jmY7RYLV?city=[tech]	RYLV	Subs.ziperto.org
https://appscity.tech/qwdGwrGB?city=[tech]	WRGB	velocitytv.com.pk/news
https://appscity.tech/HjQF2db4?city=[tech]	2DB4	velocitytv.com.pk/insurance
https://appscity.tech/LvwgN4d6?city=[tech]	N4D6	velocitytv.com.pk/finance
https://appscity.tech/ZzqBxcgM?city=[tech]	XCGM	velocitytv.com.pk/dollar
https://appscity.tech/8f9fdwdM?city=[tech]	DWDM	eat.foodsfact.org
https://appscity.tech/6Sp9wmYn?city=[tech]	WMYN	property.foodsfact.org
https://appscity.tech/3bRStX5X?city=[tech]	TX5X	finance.foodsfact.org
https://appscity.tech/s6c34SVN?city=[tech]	4SVN	insurance.foodsfact.org
https://appscity.tech/CLHNtg1D?city=[tech]	TG1D	guides.foodsfact.org
`.trim();

const lines = rawData.split("\n");
const items = lines.map((l) => {
  const parts = l.trim().split(/\s+/);
  const keitaroUrl = parts[0];
  const urlObj = new URL(keitaroUrl);
  const alias = urlObj.pathname.replace(/^\/+/, "");
  const code = parts[1];
  const target = parts[2].toLowerCase();
  return { keitaroUrl, alias, code, target };
});

console.log(`Parsed ${items.length} master Keitaro routes.`);
fs.writeFileSync("tigerroi-gateway/src/keitaro-master.json", JSON.stringify(items, null, 2));
