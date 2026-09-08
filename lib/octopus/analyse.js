/**
 * Turns raw Octopus consumption + tariff payloads into the compact,
 * pre-costed shape the dashboard page embeds and charts client side.
 *
 * All bucketing is done in Europe/London so a "day" matches a billing day
 * and the half-hourly profile lines up with the clock the meter reads on.
 */

const { buildRateLookup } = require("./tariffs");

const TZ = "Europe/London";
const SLOTS_PER_DAY = 48;

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

const localDay = date => dayFormatter.format(date);

/** 00:00 -> 0, 00:30 -> 1, ... 23:30 -> 47. */
const localSlot = date => {
  const [hour, minute] = timeFormatter.format(date).split(":").map(Number);
  return Math.min(SLOTS_PER_DAY - 1, hour * 2 + (minute >= 30 ? 1 : 0));
};

const round = (value, dp) => {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
};

/** Gas from a SMETS2 meter arrives as cubic metres and has to be converted. */
const gasToKwh = (value, gasConfig) =>
  gasConfig.units === "kwh"
    ? value
    : (value * gasConfig.volumeCorrection * gasConfig.calorificValue) / 3.6;

const normalise = (readings = [], transform = v => v) =>
  readings
    .map(reading => ({
      t: new Date(reading.interval_start).getTime(),
      kwh: transform(Number(reading.consumption) || 0)
    }))
    .filter(reading => Number.isFinite(reading.t))
    .sort((a, b) => a.t - b.t);

/**
 * Cost each interval at the unit rate in force at that instant, so a
 * half-hourly tariff (Agile, Go) is costed correctly rather than averaged.
 */
const costIntervals = (intervals, rateLookup, fallbackRate) => {
  const lookup = rateLookup && !rateLookup.isEmpty ? rateLookup : () => fallbackRate;

  return intervals.map(interval => {
    const rate = lookup(interval.t);
    return { ...interval, rate, cost: (interval.kwh * rate) / 100 };
  });
};

const emptyDay = date => ({
  date,
  ek: 0, // electricity kWh
  ec: 0, // electricity unit cost, £
  gk: 0, // gas kWh
  gc: 0, // gas unit cost, £
  sc: 0 // standing charges, £
});

module.exports = function analyse(raw, config) {
  const gasConfig = config.gas;

  const elecRates = buildRateLookup(raw.electricity.unitRates, config.fallbackRates.electricityUnitRate);
  const gasRates = buildRateLookup(raw.gas.unitRates, config.fallbackRates.gasUnitRate);
  const elecStanding = buildRateLookup(raw.electricity.standingCharges, config.fallbackRates.electricityStandingCharge);
  const gasStanding = buildRateLookup(raw.gas.standingCharges, config.fallbackRates.gasStandingCharge);

  const elec = costIntervals(
    normalise(raw.electricity.consumption),
    elecRates,
    config.fallbackRates.electricityUnitRate
  );
  const gas = costIntervals(
    normalise(raw.gas.consumption, value => gasToKwh(value, gasConfig)),
    gasRates,
    config.fallbackRates.gasUnitRate
  );

  // --- Daily totals -------------------------------------------------------
  const byDay = new Map();
  const touchDay = date => {
    if (!byDay.has(date)) byDay.set(date, emptyDay(date));
    return byDay.get(date);
  };

  elec.forEach(interval => {
    const day = touchDay(localDay(new Date(interval.t)));
    day.ek += interval.kwh;
    day.ec += interval.cost;
  });

  gas.forEach(interval => {
    const day = touchDay(localDay(new Date(interval.t)));
    day.gk += interval.kwh;
    day.gc += interval.cost;
  });

  const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));

  // Standing charges only apply on days the meters actually reported.
  days.forEach(day => {
    const noon = new Date(`${day.date}T12:00:00Z`).getTime();
    const elecDaily = day.ek > 0 || elec.length ? elecStanding(noon) : 0;
    const gasDaily = gas.length ? gasStanding(noon) : 0;
    day.sc = (elecDaily + gasDaily) / 100;
  });

  // Drop the leading and trailing part-days the API window always clips.
  const complete = days.filter(day => day.ek > 0 || day.gk > 0);
  const trimmed = complete.length > 2 ? complete.slice(1, -1) : complete;

  // --- Half-hourly electricity matrix, one row per day --------------------
  const dayIndex = new Map(trimmed.map((day, index) => [day.date, index]));
  const slots = trimmed.map(() => new Array(SLOTS_PER_DAY).fill(0));
  const rateTotals = new Array(SLOTS_PER_DAY).fill(0);
  const rateCounts = new Array(SLOTS_PER_DAY).fill(0);

  elec.forEach(interval => {
    const date = new Date(interval.t);
    const row = dayIndex.get(localDay(date));
    if (row === undefined) return;

    const slot = localSlot(date);
    slots[row][slot] += interval.kwh;
    rateTotals[slot] += interval.rate;
    rateCounts[slot] += 1;
  });

  const rateProfile = rateTotals.map((total, slot) =>
    rateCounts[slot] ? round(total / rateCounts[slot], 2) : null
  );

  // --- Metadata the dashboard shows so the numbers can be trusted ---------
  const unitRateSpread = values => {
    if (!values.length) return null;
    return { min: round(Math.min(...values), 2), max: round(Math.max(...values), 2) };
  };

  const now = new Date();

  return {
    meta: {
      source: raw.source,
      fetchedAt: raw.fetchedAt || now.toISOString(),
      timezone: TZ,
      electricity: {
        mpan: raw.electricity.mpan,
        serial: raw.electricity.serial,
        tariffCode: raw.electricity.tariffCode || null,
        gsp: raw.electricity.gsp || null,
        standingCharge: round(elecStanding(now.getTime()), 2),
        unitRate: unitRateSpread(elecRates.values),
        halfHourly: new Set(elecRates.values).size > 4
      },
      gas: {
        mprn: raw.gas.mprn,
        serial: raw.gas.serial,
        tariffCode: raw.gas.tariffCode || null,
        standingCharge: round(gasStanding(now.getTime()), 2),
        unitRate: unitRateSpread(gasRates.values),
        units: gasConfig.units,
        calorificValue: gasConfig.calorificValue,
        volumeCorrection: gasConfig.volumeCorrection
      },
      warnings: raw.warnings || []
    },

    days: trimmed.map(day => ({
      date: day.date,
      ek: round(day.ek, 3),
      ec: round(day.ec, 4),
      gk: round(day.gk, 3),
      gc: round(day.gc, 4),
      sc: round(day.sc, 4)
    })),

    halfHourly: {
      dates: trimmed.map(day => day.date),
      slots: slots.map(row => row.map(value => round(value, 3)))
    },

    rateProfile
  };
};

module.exports.SLOTS_PER_DAY = SLOTS_PER_DAY;
module.exports.gasToKwh = gasToKwh;
