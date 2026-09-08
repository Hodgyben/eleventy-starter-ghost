/**
 * Deterministic synthetic data in the exact shape the API returns, so the
 * site still builds (and looks right) without credentials — or when the
 * network is unavailable. Everything it produces is labelled as demo data
 * in the UI; it is never presented as a real reading.
 */

const HALF_HOUR = 30 * 60 * 1000;

/** Mulberry32 — small, seeded, and stable across builds. */
const rng = seed => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const electricityShape = (slot, isWeekend) => {
  const hour = slot / 2;
  const peak = (centre, width, height) =>
    height * Math.exp(-(((hour - centre) / width) ** 2));

  const base = 0.075 + (hour >= 1 && hour <= 5 ? -0.02 : 0);

  return isWeekend
    ? base + peak(9.5, 2.2, 0.18) + peak(13, 1.8, 0.14) + peak(18.5, 2.4, 0.34)
    : base + peak(7, 1.1, 0.26) + peak(12.5, 1.4, 0.07) + peak(18.5, 2.1, 0.38);
};

/** Gas is heating-led, so it tracks the season as well as the clock. */
const gasShape = (slot, month, isWeekend) => {
  const hour = slot / 2;
  const peak = (centre, width, height) =>
    height * Math.exp(-(((hour - centre) / width) ** 2));

  // 0 in midsummer, 1 in midwinter.
  const seasonal = 0.5 - 0.5 * Math.cos(((month + 0.5) / 12) * 2 * Math.PI + Math.PI);
  const heating = 0.15 + 1.15 * seasonal;

  const shape = isWeekend
    ? peak(8.5, 1.6, 0.55) + peak(19, 2.4, 0.6)
    : peak(6.75, 1.2, 0.6) + peak(18.5, 2.2, 0.65);

  return (0.012 + shape * heating) / 11.2; // kWh -> cubic metres
};

const rate = (validFrom, value) => ({
  valid_from: validFrom,
  valid_to: null,
  value_exc_vat: Math.round((value / 1.05) * 100) / 100,
  value_inc_vat: value
});

module.exports = function demoData(config, days) {
  const random = rng(20260908);
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);

  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const electricity = [];
  const gas = [];

  for (let t = start.getTime(); t < end.getTime(); t += HALF_HOUR) {
    const at = new Date(t);
    const slot = at.getUTCHours() * 2 + (at.getUTCMinutes() >= 30 ? 1 : 0);
    const isWeekend = at.getUTCDay() === 0 || at.getUTCDay() === 6;

    const interval = {
      interval_start: at.toISOString(),
      interval_end: new Date(t + HALF_HOUR).toISOString()
    };

    const noise = 0.75 + random() * 0.6;
    const spike = random() > 0.985 ? 0.9 + random() * 1.4 : 0;

    electricity.push({
      ...interval,
      consumption: Math.max(0, Math.round((electricityShape(slot, isWeekend) * noise + spike) * 1000) / 1000)
    });

    gas.push({
      ...interval,
      consumption: Math.max(
        0,
        Math.round(gasShape(slot, at.getUTCMonth(), isWeekend) * (0.8 + random() * 0.45) * 1000) / 1000
      )
    });
  }

  const from = start.toISOString();
  const { fallbackRates } = config;

  return {
    source: "demo",
    fetchedAt: new Date().toISOString(),
    warnings: [
      "Showing generated demo data — set OCTOPUS_API_KEY (and the meter identifiers) to chart your real consumption."
    ],
    electricity: {
      mpan: config.electricity.mpan || "—",
      serial: config.electricity.serial || "—",
      tariffCode: "DEMO-FIXED",
      gsp: null,
      consumption: electricity,
      unitRates: [rate(from, fallbackRates.electricityUnitRate)],
      standingCharges: [rate(from, fallbackRates.electricityStandingCharge)]
    },
    gas: {
      mprn: config.gas.mprn || "—",
      serial: config.gas.serial || "—",
      tariffCode: "DEMO-FIXED",
      consumption: gas,
      unitRates: [rate(from, fallbackRates.gasUnitRate)],
      standingCharges: [rate(from, fallbackRates.gasStandingCharge)]
    }
  };
};
