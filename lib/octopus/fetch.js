/**
 * Orchestrates a full pull: resolve tariffs, download consumption and
 * rates for both meters, and cache the raw payload.
 *
 * The dashboard must never break the build, so every failure degrades:
 * live data -> cached data -> demo data, with the reason surfaced in the UI.
 */

const fs = require("fs");
const path = require("path");

const { OctopusClient } = require("./client");
const { parseTariffCode, findTariffCode } = require("./tariffs");
const demoData = require("./demo");

const DAY = 24 * 60 * 60 * 1000;

const readCache = (file, maxAgeMinutes) => {
  try {
    const cached = JSON.parse(fs.readFileSync(file, "utf8"));
    const age = (Date.now() - new Date(cached.fetchedAt).getTime()) / 60000;

    if (!Number.isFinite(age)) return null;
    return { cached, stale: age > maxAgeMinutes };
  } catch (error) {
    return null;
  }
};

const writeCache = (file, payload) => {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(payload));
  } catch (error) {
    console.warn(`[octopus] could not write cache: ${error.message}`);
  }
};

/**
 * Rates are published per product + tariff code. Prefer the tariff the
 * account is actually on; fall back to an explicitly configured code.
 */
const loadTariff = async (client, fuel, tariffCode, window, warnings) => {
  const parsed = parseTariffCode(tariffCode);
  if (!parsed) return { tariffCode: null, unitRates: [], standingCharges: [] };

  try {
    const [unitRates, standingCharges] = await Promise.all([
      client.unitRates(fuel, parsed.productCode, parsed.tariffCode, window),
      client.standingCharges(fuel, parsed.productCode, parsed.tariffCode, window)
    ]);

    return { tariffCode: parsed.tariffCode, unitRates, standingCharges };
  } catch (error) {
    warnings.push(`Could not load ${fuel} rates for ${tariffCode} (${error.message}). Using fallback prices.`);
    return { tariffCode: parsed.tariffCode, unitRates: [], standingCharges: [] };
  }
};

const fetchLive = async config => {
  const warnings = [];
  const client = new OctopusClient(config.apiKey);

  // Pad the window by a day at each end; part-days are trimmed in analysis.
  const periodFrom = new Date(Date.now() - (config.days + 1) * DAY).toISOString();
  const periodTo = new Date(Date.now() + DAY).toISOString();
  const window = { period_from: periodFrom, period_to: periodTo };

  let account = null;
  if (config.accountNumber) {
    try {
      account = await client.account(config.accountNumber);
    } catch (error) {
      warnings.push(`Could not read account ${config.accountNumber} (${error.message}).`);
    }
  }

  let gsp = null;
  if (config.electricity.mpan) {
    try {
      gsp = (await client.electricityMeterPoint(config.electricity.mpan)).gsp || null;
    } catch (error) {
      warnings.push(`Could not read meter point ${config.electricity.mpan} (${error.message}).`);
    }
  }

  const elecTariffCode =
    (account && findTariffCode(account, "electricity", config.electricity.mpan)) ||
    config.electricity.tariffCode;
  const gasTariffCode =
    (account && findTariffCode(account, "gas", config.gas.mprn)) || config.gas.tariffCode;

  if (!elecTariffCode) {
    warnings.push(
      "No electricity tariff resolved — set OCTOPUS_ACCOUNT_NUMBER or OCTOPUS_ELECTRICITY_TARIFF_CODE for real prices. Costs use fallback rates."
    );
  }
  if (!gasTariffCode) {
    warnings.push(
      "No gas tariff resolved — set OCTOPUS_ACCOUNT_NUMBER or OCTOPUS_GAS_TARIFF_CODE for real prices. Costs use fallback rates."
    );
  }

  const consumption = async (label, run) => {
    try {
      return await run();
    } catch (error) {
      warnings.push(`Could not read ${label} consumption (${error.message}).`);
      return [];
    }
  };

  const [elecConsumption, gasConsumption, elecTariff, gasTariff] = await Promise.all([
    config.electricity.mpan && config.electricity.serial
      ? consumption("electricity", () =>
        client.electricityConsumption(config.electricity.mpan, config.electricity.serial, window))
      : [],
    config.gas.mprn && config.gas.serial
      ? consumption("gas", () => client.gasConsumption(config.gas.mprn, config.gas.serial, window))
      : [],
    loadTariff(client, "electricity", elecTariffCode, window, warnings),
    loadTariff(client, "gas", gasTariffCode, window, warnings)
  ]);

  if (!elecConsumption.length && !gasConsumption.length) {
    throw new Error("The API returned no consumption for either meter");
  }

  return {
    source: "live",
    fetchedAt: new Date().toISOString(),
    warnings,
    electricity: {
      mpan: config.electricity.mpan,
      serial: config.electricity.serial,
      gsp,
      consumption: elecConsumption,
      ...elecTariff
    },
    gas: {
      mprn: config.gas.mprn,
      serial: config.gas.serial,
      consumption: gasConsumption,
      ...gasTariff
    }
  };
};

/**
 * @param {object} config  from lib/octopus/config.js
 * @param {object} options `force` skips the freshness check on the cache.
 */
module.exports = async function fetchOctopusData(config, options = {}) {
  const cache = readCache(config.cacheFile, config.cacheMaxAgeMinutes);

  if (cache && !cache.stale && !options.force) {
    console.log(`[octopus] using cached data from ${cache.cached.fetchedAt}`);
    return { ...cache.cached, source: "cache" };
  }

  if (!config.apiKey) {
    console.log("[octopus] no OCTOPUS_API_KEY set — using demo data");
    return demoData(config, config.days);
  }

  try {
    const live = await fetchLive(config);
    writeCache(config.cacheFile, live);
    console.log(
      `[octopus] fetched ${live.electricity.consumption.length} electricity and ` +
      `${live.gas.consumption.length} gas readings`
    );
    return live;
  } catch (error) {
    console.warn(`[octopus] live fetch failed: ${error.message}`);

    if (cache) {
      return {
        ...cache.cached,
        source: "cache",
        warnings: [
          ...(cache.cached.warnings || []),
          `Live refresh failed (${error.message}); showing cached data from ${cache.cached.fetchedAt}.`
        ]
      };
    }

    const demo = demoData(config, config.days);
    demo.warnings.unshift(`Live fetch failed (${error.message}).`);
    return demo;
  }
};
