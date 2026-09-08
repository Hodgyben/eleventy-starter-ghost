/**
 * Global data for the energy dashboard.
 *
 * `.env.local` is loaded first and wins, because dotenv never overwrites a
 * variable that is already set — that keeps the live API key out of the
 * committed `.env`.
 */

require("dotenv").config({ path: ".env.local" });
require("dotenv").config();

const readConfig = require("../../lib/octopus/config");
const fetchOctopusData = require("../../lib/octopus/fetch");
const analyse = require("../../lib/octopus/analyse");

module.exports = async function() {
  const config = readConfig();
  const raw = await fetchOctopusData(config);

  return analyse(raw, config);
};
