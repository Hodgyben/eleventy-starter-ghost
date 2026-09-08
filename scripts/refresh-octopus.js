#!/usr/bin/env node
/**
 * Force a fresh pull from the Octopus API into the local cache, then print
 * a short summary. Handy for checking credentials before a build:
 *
 *   pnpm octopus:refresh
 */

require("dotenv").config({ path: ".env.local" });
require("dotenv").config();

const readConfig = require("../lib/octopus/config");
const fetchOctopusData = require("../lib/octopus/fetch");
const analyse = require("../lib/octopus/analyse");

const money = value => `£${value.toFixed(2)}`;

(async () => {
  const config = readConfig();

  if (!config.apiKey) {
    console.error("OCTOPUS_API_KEY is not set — nothing to refresh.");
    console.error("Copy .env.example to .env.local and fill it in.");
    process.exit(1);
  }

  const raw = await fetchOctopusData(config, { force: true });
  const data = analyse(raw, config);

  const total = data.days.reduce((sum, day) => sum + day.ec + day.gc + day.sc, 0);
  const elec = data.days.reduce((sum, day) => sum + day.ek, 0);
  const gas = data.days.reduce((sum, day) => sum + day.gk, 0);

  console.log(`source            ${data.meta.source}`);
  console.log(`days              ${data.days.length} (${data.days[0]?.date} to ${data.days.at(-1)?.date})`);
  console.log(`electricity       ${elec.toFixed(1)} kWh  tariff ${data.meta.electricity.tariffCode || "—"}`);
  console.log(`gas               ${gas.toFixed(1)} kWh  tariff ${data.meta.gas.tariffCode || "—"}`);
  console.log(`estimated cost    ${money(total)}`);

  data.meta.warnings.forEach(warning => console.warn(`warning           ${warning}`));

  if (data.meta.source !== "live") process.exitCode = 2;
})().catch(error => {
  console.error(error);
  process.exit(1);
});
