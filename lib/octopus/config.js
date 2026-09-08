/**
 * Everything the dashboard needs to know about the meters, read from the
 * environment so no credentials are ever committed.
 *
 * Put real values in `.env.local` (git-ignored) or in the host's build
 * environment variables. The dashboard falls back to demo data when
 * `OCTOPUS_API_KEY` is absent, so the site always builds.
 */

const num = (value, fallback) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

module.exports = function readConfig(env = process.env) {
  return {
    apiKey: env.OCTOPUS_API_KEY || "",
    accountNumber: env.OCTOPUS_ACCOUNT_NUMBER || "",

    electricity: {
      mpan: env.OCTOPUS_ELECTRICITY_MPAN || "",
      serial: env.OCTOPUS_ELECTRICITY_SERIAL || "",
      tariffCode: env.OCTOPUS_ELECTRICITY_TARIFF_CODE || ""
    },

    gas: {
      mprn: env.OCTOPUS_GAS_MPRN || "",
      serial: env.OCTOPUS_GAS_SERIAL || "",
      tariffCode: env.OCTOPUS_GAS_TARIFF_CODE || "",

      // SMETS2 gas meters report cubic metres; SMETS1 meters report kWh.
      units: (env.OCTOPUS_GAS_UNITS || "m3").toLowerCase() === "kwh" ? "kwh" : "m3",
      calorificValue: num(env.OCTOPUS_GAS_CALORIFIC_VALUE, 39.5),
      volumeCorrection: num(env.OCTOPUS_GAS_VOLUME_CORRECTION, 1.02264)
    },

    // How much history to pull and show.
    days: Math.max(7, Math.round(num(env.OCTOPUS_HISTORY_DAYS, 90))),

    // Cache the raw API payload so repeat builds don't re-download it.
    cacheFile: env.OCTOPUS_CACHE_FILE || ".cache/octopus.json",
    cacheMaxAgeMinutes: num(env.OCTOPUS_CACHE_MAX_AGE_MINUTES, 180),

    // Used only when a tariff can't be resolved from the account/API.
    fallbackRates: {
      electricityUnitRate: num(env.OCTOPUS_FALLBACK_ELECTRICITY_UNIT_RATE, 24.5),
      electricityStandingCharge: num(env.OCTOPUS_FALLBACK_ELECTRICITY_STANDING_CHARGE, 53.8),
      gasUnitRate: num(env.OCTOPUS_FALLBACK_GAS_UNIT_RATE, 6.2),
      gasStandingCharge: num(env.OCTOPUS_FALLBACK_GAS_STANDING_CHARGE, 32.7)
    }
  };
};
