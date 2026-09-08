/**
 * Minimal client for the Octopus Energy REST API.
 *
 * Auth is HTTP Basic with the API key as the username and an empty password.
 * Every list endpoint is paginated through `next`, so `getAll` walks it.
 */

const DEFAULT_BASE_URL = "https://api.octopus.energy/v1";

class OctopusApiError extends Error {
  constructor(status, url, body) {
    super(`Octopus API ${status} for ${url}: ${body}`.slice(0, 500));
    this.name = "OctopusApiError";
    this.status = status;
    this.url = url;
  }
}

class OctopusClient {
  constructor(apiKey, options = {}) {
    if (!apiKey) throw new Error("An Octopus API key is required");

    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetch = options.fetch || globalThis.fetch;
    this.timeout = options.timeout || 30000;

    if (typeof this.fetch !== "function") {
      throw new Error("No fetch implementation available (Node 18+ required)");
    }
  }

  get authHeader() {
    return `Basic ${Buffer.from(`${this.apiKey}:`).toString("base64")}`;
  }

  buildUrl(path, params = {}) {
    const url = new URL(/^https?:/.test(path) ? path : `${this.baseUrl}${path}`);

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });

    return url.toString();
  }

  async get(path, params) {
    const url = this.buildUrl(path, params);
    const response = await this.fetch(url, {
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(this.timeout)
    });

    if (!response.ok) {
      throw new OctopusApiError(response.status, url, await response.text());
    }

    return response.json();
  }

  /**
   * Follow `next` links and concatenate every `results` array.
   * `maxPages` is a guard against a runaway range.
   */
  async getAll(path, params, maxPages = 40) {
    const results = [];
    let next = this.buildUrl(path, params);
    let pages = 0;

    while (next && pages < maxPages) {
      const page = await this.get(next);
      results.push(...(page.results || []));
      next = page.next;
      pages += 1;
    }

    return results;
  }

  /** Meter point metadata — most usefully the GSP (grid supply point) region. */
  electricityMeterPoint(mpan) {
    return this.get(`/electricity-meter-points/${mpan}/`);
  }

  account(accountNumber) {
    return this.get(`/accounts/${accountNumber}/`);
  }

  electricityConsumption(mpan, serial, params) {
    return this.getAll(
      `/electricity-meter-points/${mpan}/meters/${serial}/consumption/`,
      { page_size: 25000, order_by: "period", ...params }
    );
  }

  gasConsumption(mprn, serial, params) {
    return this.getAll(
      `/gas-meter-points/${mprn}/meters/${serial}/consumption/`,
      { page_size: 25000, order_by: "period", ...params }
    );
  }

  /** `fuel` is "electricity" or "gas"; tariffs live under the product. */
  unitRates(fuel, productCode, tariffCode, params) {
    return this.getAll(
      `/products/${productCode}/${fuel}-tariffs/${tariffCode}/standard-unit-rates/`,
      { page_size: 1500, ...params }
    );
  }

  standingCharges(fuel, productCode, tariffCode, params) {
    return this.getAll(
      `/products/${productCode}/${fuel}-tariffs/${tariffCode}/standing-charges/`,
      { page_size: 1500, ...params }
    );
  }
}

module.exports = { OctopusClient, OctopusApiError, DEFAULT_BASE_URL };
