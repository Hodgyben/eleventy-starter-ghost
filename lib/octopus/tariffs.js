/**
 * Tariff codes look like `E-1R-VAR-22-11-01-A`:
 * fuel letter, rate type, product code, then the GSP region letter.
 * The product code is what the /products/ endpoints are keyed on.
 */

const parseTariffCode = tariffCode => {
  if (!tariffCode) return null;

  const parts = tariffCode.split("-");
  if (parts.length < 4) return null;

  return {
    tariffCode,
    fuel: parts[0] === "G" ? "gas" : "electricity",
    rateType: parts[1],
    productCode: parts.slice(2, -1).join("-"),
    region: parts[parts.length - 1]
  };
};

/** An agreement is current if it has started and hasn't ended yet. */
const pickAgreement = (agreements = [], at = new Date()) => {
  const time = at.getTime();
  const started = agreements.filter(a => new Date(a.valid_from).getTime() <= time);
  const live = started.filter(a => !a.valid_to || new Date(a.valid_to).getTime() > time);
  const pool = live.length ? live : started;

  return pool.sort(
    (a, b) => new Date(b.valid_from) - new Date(a.valid_from)
  )[0] || null;
};

/**
 * Walk an /accounts/ payload for the agreement covering a given meter point.
 * `identifier` is the MPAN for electricity or the MPRN for gas.
 */
const findTariffCode = (account, fuel, identifier, at = new Date()) => {
  const key = fuel === "gas" ? "gas_meter_points" : "electricity_meter_points";
  const idKey = fuel === "gas" ? "mprn" : "mpan";

  for (const property of account?.properties || []) {
    for (const point of property[key] || []) {
      if (identifier && String(point[idKey]) !== String(identifier)) continue;

      const agreement = pickAgreement(point.agreements, at);
      if (agreement?.tariff_code) return agreement.tariff_code;
    }
  }

  return null;
};

/**
 * Turn a rate list into a lookup. Rates arrive newest-first with
 * `valid_to: null` meaning "still current"; sorting oldest-first lets a
 * reverse scan find the band covering any instant, which is what a
 * half-hourly tariff such as Agile needs.
 */
const buildRateLookup = (rates = [], fallbackValue = 0) => {
  const bands = rates
    .map(rate => ({
      from: new Date(rate.valid_from).getTime(),
      to: rate.valid_to ? new Date(rate.valid_to).getTime() : Infinity,
      value: rate.value_inc_vat
    }))
    .filter(band => Number.isFinite(band.from) && Number.isFinite(band.value))
    .sort((a, b) => a.from - b.from);

  const lookup = timestamp => {
    for (let i = bands.length - 1; i >= 0; i -= 1) {
      if (timestamp >= bands[i].from && timestamp < bands[i].to) return bands[i].value;
    }
    return bands.length ? bands[0].value : fallbackValue;
  };

  lookup.isEmpty = bands.length === 0;
  lookup.values = bands.map(band => band.value);

  return lookup;
};

module.exports = { parseTariffCode, pickAgreement, findTariffCode, buildRateLookup };
