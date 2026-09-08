/* Octopus Energy dashboard
 * ---------------------------------------------------------------------------
 * Reads the build-time payload embedded in the page, aggregates it for the
 * selected date range, and draws the charts as inline SVG. No dependencies.
 *
 * Chart conventions: one y-axis per plot, thin marks, hairline grid, a 2px
 * surface gap between adjacent fills, hover tooltips as an enhancement, and a
 * table view behind every chart so no value is reachable by colour alone.
 */
(function () {
  "use strict";

  var root = document.querySelector("[data-energy]");
  var payload = document.getElementById("energy-data");
  if (!root || !payload) return;

  var DATA = JSON.parse(payload.textContent);
  var SLOTS = 48;
  var NS = "http://www.w3.org/2000/svg";

  var DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  /* -- formatting --------------------------------------------------------- */

  var fmtKwh = function (value, dp) {
    return value.toFixed(dp === undefined ? 1 : dp) + " kWh";
  };
  var fmtMoney = function (value) {
    return "£" + value.toFixed(2);
  };
  var fmtPence = function (value) {
    return value.toFixed(2) + "p";
  };
  var fmtSlot = function (slot) {
    var hour = Math.floor(slot / 2);
    return (hour < 10 ? "0" : "") + hour + (slot % 2 ? ":30" : ":00");
  };
  /** "9 Aug" — for axes where the weekday would not fit. */
  var fmtDayMonth = function (iso) {
    var parts = iso.split("-");
    return new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2])).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC"
    });
  };

  var fmtDate = function (iso, withYear) {
    var parts = iso.split("-");
    var date = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
    return date.toLocaleDateString("en-GB", {
      weekday: withYear ? undefined : "short",
      day: "numeric",
      month: "short",
      year: withYear ? "numeric" : undefined,
      timeZone: "UTC"
    });
  };
  var isoDow = function (iso) {
    var parts = iso.split("-");
    return (new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2])).getUTCDay() + 6) % 7;
  };

  var cssVar = function (name) {
    return getComputedStyle(root).getPropertyValue(name).trim();
  };

  /* -- tiny SVG helpers --------------------------------------------------- */

  function el(name, attrs, text) {
    var node = document.createElementNS(NS, name);
    for (var key in attrs) {
      if (attrs[key] !== null && attrs[key] !== undefined) {
        node.setAttribute(key, attrs[key]);
      }
    }
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** A bar with rounded top corners, anchored flat to the baseline. */
  function barPath(x, y, width, height, radius) {
    var r = Math.max(0, Math.min(radius, width / 2, height));
    return (
      "M" + x + "," + (y + height) +
      "V" + (y + r) +
      "a" + r + "," + r + " 0 0 1 " + r + ",-" + r +
      "h" + (width - 2 * r) +
      "a" + r + "," + r + " 0 0 1 " + r + "," + r +
      "V" + (y + height) + "Z"
    );
  }

  /** Rounded "nice" tick values for a 0..max axis. */
  function ticks(max, count) {
    if (!(max > 0)) return [0, 1];
    var raw = max / count;
    var magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
    var step = [1, 2, 2.5, 5, 10].reduce(function (best, multiple) {
      var candidate = multiple * magnitude;
      return candidate >= raw && (best === null || candidate < best) ? candidate : best;
    }, null) || magnitude * 10;

    // Keep stepping until the axis top covers `max`, so the tallest mark
    // always fits inside the plot.
    var values = [];
    for (var value = 0; ; value += step) {
      values.push(Math.round(value * 1e6) / 1e6);
      if (value >= max - step * 1e-6) break;
    }
    return values;
  }

  /* -- tooltip ------------------------------------------------------------ */

  var tooltip = document.createElement("div");
  tooltip.className = "energy-tooltip";
  tooltip.hidden = true;
  tooltip.setAttribute("role", "status");
  document.body.appendChild(tooltip);

  function showTooltip(html, event) {
    tooltip.innerHTML = html;
    tooltip.hidden = false;

    var box = tooltip.getBoundingClientRect();
    var left = event.clientX + 14;
    var top = event.clientY - box.height - 12;

    if (left + box.width > window.innerWidth - 8) left = event.clientX - box.width - 14;
    if (top < 8) top = event.clientY + 18;

    tooltip.style.left = Math.max(8, left) + "px";
    tooltip.style.top = top + "px";
  }

  function hideTooltip() {
    tooltip.hidden = true;
  }

  function tooltipRows(title, rows) {
    return (
      '<div class="energy-tooltip-title">' + title + "</div>" +
      rows
        .map(function (row) {
          var swatch = row.color
            ? '<span class="energy-swatch" style="background:' + row.color + '"></span>'
            : "";
          return '<div class="energy-tooltip-row">' + swatch + row.label + "<b>" + row.value + "</b></div>";
        })
        .join("")
    );
  }

  /* -- chart frame -------------------------------------------------------- */

  function frame(host, options) {
    var measured = host.getBoundingClientRect().width || host.clientWidth;
    var width = Math.max(280, Math.round(measured) || 640);
    var margin = options.margin;
    var height = options.height;

    var svg = el("svg", {
      viewBox: "0 0 " + width + " " + height,
      preserveAspectRatio: "xMidYMid meet",
      role: "img",
      "aria-label": options.label
    });

    host.innerHTML = "";
    host.appendChild(svg);

    return {
      svg: svg,
      width: width,
      height: height,
      plotW: width - margin.left - margin.right,
      plotH: height - margin.top - margin.bottom,
      left: margin.left,
      top: margin.top
    };
  }

  /** Horizontal hairline grid plus right-aligned tick labels. */
  function yAxis(f, scaleMax, format) {
    var values = ticks(scaleMax, 4);
    var top = values[values.length - 1];

    values.forEach(function (value) {
      var y = f.top + f.plotH - (value / top) * f.plotH;
      f.svg.appendChild(
        el("line", {
          x1: f.left,
          x2: f.left + f.plotW,
          y1: y,
          y2: y,
          class: value === 0 ? "energy-baseline" : "energy-grid-line"
        })
      );
      f.svg.appendChild(
        el("text", {
          x: f.left - 8,
          y: y + 4,
          "text-anchor": "end",
          class: "energy-tick"
        }, format(value))
      );
    });

    return top;
  }

  /** Date ticks along the x axis, thinned to fit the plot width. */
  function dateTicks(f, rows, step, y) {
    var target = f.plotW < 420 ? 4 : 6;
    var every = Math.max(1, Math.round(rows.length / target));
    var shown = [];

    rows.forEach(function (day, index) {
      if (index % every === 0) shown.push(index);
    });

    var last = rows.length - 1;
    if (last - shown[shown.length - 1] < every * 0.9) shown.pop();
    if (shown[shown.length - 1] !== last) shown.push(last);

    shown.forEach(function (index) {
      f.svg.appendChild(el("text", {
        x: f.left + index * step + step / 2,
        y: y,
        "text-anchor": index === last ? "end" : index === 0 ? "start" : "middle",
        class: "energy-tick"
      }, fmtDayMonth(rows[index].date)));
    });
  }

  /* -- aggregation -------------------------------------------------------- */

  function slice(days) {
    var all = DATA.days;
    return days >= all.length ? all.slice() : all.slice(all.length - days);
  }

  function totals(rows) {
    return rows.reduce(
      function (acc, day) {
        acc.ek += day.ek;
        acc.gk += day.gk;
        acc.ec += day.ec;
        acc.gc += day.gc;
        acc.sc += day.sc;
        acc.cost += day.ec + day.gc + day.sc;
        return acc;
      },
      { ek: 0, gk: 0, ec: 0, gc: 0, sc: 0, cost: 0 }
    );
  }

  /* -- table view --------------------------------------------------------- */

  function tableView(card, columns, rows) {
    var wrap = card.querySelector("[data-table]");
    var button = card.querySelector("[data-table-toggle]");
    if (!wrap) return;

    var table = document.createElement("table");
    table.className = "energy-table";

    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    columns.forEach(function (column) {
      var th = document.createElement("th");
      th.scope = "col";
      th.textContent = column;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    rows.forEach(function (cells) {
      var tr = document.createElement("tr");
      cells.forEach(function (cell, index) {
        var td = document.createElement(index === 0 ? "th" : "td");
        if (index === 0) td.scope = "row";
        td.textContent = cell;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    wrap.innerHTML = "";
    wrap.appendChild(table);

    if (button && !button.dataset.bound) {
      button.dataset.bound = "1";
      button.addEventListener("click", function () {
        var open = wrap.hidden;
        wrap.hidden = !open;
        button.setAttribute("aria-expanded", String(open));
        button.textContent = open ? "Hide table" : "Show table";
      });
    }
  }

  /* -- stat tiles --------------------------------------------------------- */

  function renderTiles(rows) {
    var current = totals(rows);
    var previousRows = (function () {
      var all = DATA.days;
      var end = all.length - rows.length;
      return all.slice(Math.max(0, end - rows.length), end);
    })();
    var previous = previousRows.length ? totals(previousRows) : null;

    var tiles = [
      {
        key: "cost",
        label: "Estimated cost",
        value: fmtMoney(current.cost),
        unit: "",
        now: current.cost,
        was: previous && previous.cost,
        detail: fmtMoney(current.cost / rows.length) + " a day"
      },
      {
        key: "elec",
        label: "Electricity",
        swatch: "is-elec",
        value: current.ek.toFixed(0),
        unit: "kWh",
        now: current.ek,
        was: previous && previous.ek,
        detail: fmtKwh(current.ek / rows.length) + " a day · " + fmtMoney(current.ec)
      },
      {
        key: "gas",
        label: "Gas",
        swatch: "is-gas",
        value: current.gk.toFixed(0),
        unit: "kWh",
        now: current.gk,
        was: previous && previous.gk,
        detail: fmtKwh(current.gk / rows.length) + " a day · " + fmtMoney(current.gc)
      },
      {
        key: "standing",
        label: "Standing charges",
        value: fmtMoney(current.sc),
        unit: "",
        now: current.sc,
        was: previous && previous.sc,
        detail: Math.round((current.sc / current.cost) * 100) + "% of the bill"
      }
    ];

    var host = root.querySelector("[data-tiles]");
    host.innerHTML = "";

    tiles.forEach(function (tile) {
      var node = document.createElement("div");
      node.className = "energy-tile";

      var change = "";
      if (tile.was) {
        var delta = ((tile.now - tile.was) / tile.was) * 100;
        var direction = delta >= 0.5 ? "is-up" : delta <= -0.5 ? "is-down" : "";
        var arrow = delta >= 0.5 ? "▲" : delta <= -0.5 ? "▼" : "→";
        change =
          '<p class="energy-tile-delta ' + direction + '"><b>' + arrow + " " +
          Math.abs(delta).toFixed(1) + "%</b> vs previous " + rows.length + " days</p>";
      }

      node.innerHTML =
        '<div class="energy-tile-label">' +
        (tile.swatch ? '<span class="energy-swatch ' + tile.swatch + '"></span>' : "") +
        tile.label +
        "</div>" +
        '<p class="energy-tile-value">' + tile.value +
        (tile.unit ? " <small>" + tile.unit + "</small>" : "") + "</p>" +
        '<p class="energy-tile-delta">' + tile.detail + "</p>" +
        change;

      host.appendChild(node);
    });
  }

  /* -- daily energy (stacked kWh) ----------------------------------------- */

  function renderDailyEnergy(rows) {
    var card = root.querySelector("[data-card='daily-energy']");
    var host = card.querySelector("[data-plot]");
    var elec = cssVar("--elec");
    var gas = cssVar("--gas");

    var f = frame(host, {
      height: 306,
      margin: { top: 24, right: 12, bottom: 34, left: 44 },
      label: "Daily electricity and gas use in kilowatt hours"
    });

    var max = Math.max.apply(null, rows.map(function (day) { return day.ek + day.gk; }).concat([1]));
    var top = yAxis(f, max, function (value) { return value.toFixed(0); });

    var step = f.plotW / rows.length;
    var gap = Math.min(2, step * 0.3);
    // Cap the width so a short range draws thin marks rather than slabs.
    var barW = Math.min(48, Math.max(1, step - gap));
    var offset = (step - barW) / 2;
    var scale = function (value) { return (value / top) * f.plotH; };

    rows.forEach(function (day, index) {
      var x = f.left + index * step + offset;
      var gasH = scale(day.gk);
      var elecH = scale(day.ek);
      var baseline = f.top + f.plotH;

      // Gas sits on top of electricity, with a 2px surface gap between fills.
      if (elecH > 0.4) {
        f.svg.appendChild(el("path", {
          d: barPath(x, baseline - elecH, barW, elecH, gasH > 2 ? 0 : 4),
          fill: elec
        }));
      }
      if (gasH > 0.4) {
        var gasBottom = baseline - elecH - (elecH > 0.4 ? 2 : 0);
        f.svg.appendChild(el("path", {
          d: barPath(x, gasBottom - gasH, barW, gasH, 4),
          fill: gas
        }));
      }

      var hit = el("rect", {
        x: f.left + index * step,
        y: f.top,
        width: step,
        height: f.plotH,
        class: "energy-hit"
      });
      hit.addEventListener("pointermove", function (event) {
        showTooltip(
          tooltipRows(fmtDate(day.date), [
            { label: "Electricity", value: fmtKwh(day.ek), color: elec },
            { label: "Gas", value: fmtKwh(day.gk), color: gas },
            { label: "Cost", value: fmtMoney(day.ec + day.gc + day.sc) }
          ]),
          event
        );
      });
      hit.addEventListener("pointerleave", hideTooltip);
      f.svg.appendChild(hit);
    });

    dateTicks(f, rows, step, f.top + f.plotH + 20);

    f.svg.appendChild(el("text", { x: 0, y: 12, class: "energy-axis-label" }, "kWh"));

    tableView(
      card,
      ["Day", "Electricity", "Gas", "Total", "Cost"],
      rows.slice().reverse().map(function (day) {
        return [
          fmtDate(day.date, true),
          day.ek.toFixed(1),
          day.gk.toFixed(1),
          (day.ek + day.gk).toFixed(1),
          fmtMoney(day.ec + day.gc + day.sc)
        ];
      })
    );
  }

  /* -- daily cost --------------------------------------------------------- */

  function renderDailyCost(rows) {
    var card = root.querySelector("[data-card='daily-cost']");
    var host = card.querySelector("[data-plot]");
    var elec = cssVar("--elec");
    var accent = cssVar("--gas");

    var f = frame(host, {
      height: 306,
      margin: { top: 24, right: 12, bottom: 34, left: 46 },
      label: "Estimated daily cost"
    });

    var costs = rows.map(function (day) { return day.ec + day.gc + day.sc; });
    var max = Math.max.apply(null, costs.concat([0.5]));
    var top = yAxis(f, max, function (value) {
      return "£" + (value === 0 || value >= 1 ? value.toFixed(0) : value.toFixed(1));
    });

    var step = f.plotW / rows.length;
    var gap = Math.min(2, step * 0.3);
    var barW = Math.min(48, Math.max(1, step - gap));
    var offset = (step - barW) / 2;
    var baseline = f.top + f.plotH;

    rows.forEach(function (day, index) {
      var height = (costs[index] / top) * f.plotH;
      f.svg.appendChild(el("path", {
        d: barPath(f.left + index * step + offset, baseline - height, barW, height, 4),
        fill: elec
      }));
    });

    // Seven-day rolling mean, so the weekly rhythm reads through the noise.
    var rolling = costs.map(function (_, index) {
      var from = Math.max(0, index - 6);
      var window = costs.slice(from, index + 1);
      return window.reduce(function (a, b) { return a + b; }, 0) / window.length;
    });

    var line = rolling
      .map(function (value, index) {
        var x = f.left + index * step + step / 2;
        var y = baseline - (value / top) * f.plotH;
        return (index ? "L" : "M") + x.toFixed(1) + "," + y.toFixed(1);
      })
      .join("");

    f.svg.appendChild(el("path", {
      d: line,
      fill: "none",
      stroke: accent,
      "stroke-width": 2,
      "stroke-linejoin": "round",
      "stroke-linecap": "round"
    }));

    var lastX = f.left + (rows.length - 1) * step + step / 2;
    var lastY = baseline - (rolling[rolling.length - 1] / top) * f.plotH;
    f.svg.appendChild(el("circle", {
      cx: lastX, cy: lastY, r: 4, fill: accent, stroke: cssVar("--surface-1"), "stroke-width": 2
    }));
    f.svg.appendChild(el("text", {
      x: lastX - 10,
      y: lastY - 16 < f.top + 10 ? lastY + 22 : lastY - 16,
      "text-anchor": "end",
      class: "energy-direct-label"
    }, fmtMoney(rolling[rolling.length - 1]) + " avg"));

    rows.forEach(function (day, index) {
      var hit = el("rect", {
        x: f.left + index * step, y: f.top, width: step, height: f.plotH, class: "energy-hit"
      });
      hit.addEventListener("pointermove", function (event) {
        showTooltip(
          tooltipRows(fmtDate(day.date), [
            { label: "Electricity", value: fmtMoney(day.ec), color: elec },
            { label: "Gas", value: fmtMoney(day.gc), color: cssVar("--gas") },
            { label: "Standing charge", value: fmtMoney(day.sc) },
            { label: "Total", value: fmtMoney(costs[index]) },
            { label: "7-day average", value: fmtMoney(rolling[index]) }
          ]),
          event
        );
      });
      hit.addEventListener("pointerleave", hideTooltip);
      f.svg.appendChild(hit);
    });

    dateTicks(f, rows, step, baseline + 20);

    tableView(
      card,
      ["Day", "Electricity", "Gas", "Standing", "Total", "7-day avg"],
      rows.slice().reverse().map(function (day, index) {
        var i = rows.length - 1 - index;
        return [
          fmtDate(day.date, true),
          fmtMoney(day.ec),
          fmtMoney(day.gc),
          fmtMoney(day.sc),
          fmtMoney(costs[i]),
          fmtMoney(rolling[i])
        ];
      })
    );
  }

  /* -- average day shape -------------------------------------------------- */

  function renderDayShape(rows) {
    var card = root.querySelector("[data-card='day-shape']");
    var host = card.querySelector("[data-plot]");
    var elec = cssVar("--elec");
    var gas = cssVar("--gas");

    var dates = DATA.halfHourly.dates;
    var index = {};
    dates.forEach(function (date, i) { index[date] = i; });

    var sums = [[], []];
    var counts = [0, 0];
    sums[0] = new Array(SLOTS).fill(0);
    sums[1] = new Array(SLOTS).fill(0);

    rows.forEach(function (day) {
      var row = DATA.halfHourly.slots[index[day.date]];
      if (!row) return;
      var group = isoDow(day.date) >= 5 ? 1 : 0;
      counts[group] += 1;
      for (var slot = 0; slot < SLOTS; slot += 1) sums[group][slot] += row[slot];
    });

    var series = [
      { name: "Weekday", color: elec, values: sums[0].map(function (v) { return counts[0] ? v / counts[0] : 0; }) },
      { name: "Weekend", color: gas, values: sums[1].map(function (v) { return counts[1] ? v / counts[1] : 0; }) }
    ].filter(function (s, i) { return counts[i] > 0; });

    var f = frame(host, {
      height: 312,
      margin: { top: 30, right: 16, bottom: 34, left: 52 },
      label: "Average electricity use through the day"
    });

    var max = series.reduce(function (best, s) {
      return Math.max(best, Math.max.apply(null, s.values));
    }, 0.05);
    var top = yAxis(f, max, function (value) { return value.toFixed(2); });

    var x = function (slot) { return f.left + (slot / (SLOTS - 1)) * f.plotW; };
    var y = function (value) { return f.top + f.plotH - (value / top) * f.plotH; };

    series.forEach(function (s, seriesIndex) {
      var d = s.values
        .map(function (value, slot) {
          return (slot ? "L" : "M") + x(slot).toFixed(1) + "," + y(value).toFixed(1);
        })
        .join("");

      f.svg.appendChild(el("path", {
        d: d,
        fill: "none",
        stroke: s.color,
        "stroke-width": 2,
        "stroke-linejoin": "round",
        "stroke-linecap": "round"
      }));

      // Direct-label each series at its own peak rather than every point.
      // The two peaks usually sit close together, so one label goes above the
      // marker and the other below, and both stay inside the plot.
      var peak = s.values.indexOf(Math.max.apply(null, s.values));
      var px = x(peak);
      var py = y(s.values[peak]);
      var anchorEnd = px > f.left + f.plotW * 0.6;

      f.svg.appendChild(el("circle", {
        cx: px, cy: py, r: 4,
        fill: s.color, stroke: cssVar("--surface-1"), "stroke-width": 2
      }));
      f.svg.appendChild(el("text", {
        x: px + (anchorEnd ? -8 : 8),
        y: seriesIndex === 0
          ? Math.max(f.top + 12, py - 12)
          : Math.min(f.top + f.plotH - 6, py + 20),
        "text-anchor": anchorEnd ? "end" : "start",
        class: "energy-direct-label"
      }, s.name + " peak " + fmtSlot(peak)));
    });

    [0, 12, 24, 36, 47].forEach(function (slot) {
      f.svg.appendChild(el("text", {
        x: x(slot),
        y: f.top + f.plotH + 20,
        "text-anchor": slot === 0 ? "start" : slot === 47 ? "end" : "middle",
        class: "energy-tick"
      }, fmtSlot(slot)));
    });

    f.svg.appendChild(el("text", { x: 0, y: 12, class: "energy-axis-label" }, "kWh per half hour"));

    var crosshair = el("line", {
      y1: f.top, y2: f.top + f.plotH, class: "energy-crosshair", opacity: 0
    });
    f.svg.appendChild(crosshair);

    var hit = el("rect", {
      x: f.left, y: f.top, width: f.plotW, height: f.plotH, class: "energy-hit"
    });
    hit.addEventListener("pointermove", function (event) {
      var box = f.svg.getBoundingClientRect();
      var ratio = (event.clientX - box.left - f.left) / f.plotW;
      var slot = Math.max(0, Math.min(SLOTS - 1, Math.round(ratio * (SLOTS - 1))));

      crosshair.setAttribute("x1", x(slot));
      crosshair.setAttribute("x2", x(slot));
      crosshair.setAttribute("opacity", 1);

      showTooltip(
        tooltipRows(fmtSlot(slot) + "–" + fmtSlot((slot + 1) % SLOTS), series.map(function (s) {
          return { label: s.name, value: fmtKwh(s.values[slot], 2), color: s.color };
        }).concat(
          DATA.rateProfile[slot] ? [{ label: "Avg unit rate", value: fmtPence(DATA.rateProfile[slot]) }] : []
        )),
        event
      );
    });
    hit.addEventListener("pointerleave", function () {
      crosshair.setAttribute("opacity", 0);
      hideTooltip();
    });
    f.svg.appendChild(hit);

    tableView(
      card,
      ["Half hour"].concat(series.map(function (s) { return s.name + " (kWh)"; })).concat(["Unit rate"]),
      Array.from({ length: SLOTS }, function (_, slot) {
        return [fmtSlot(slot)]
          .concat(series.map(function (s) { return s.values[slot].toFixed(3); }))
          .concat([DATA.rateProfile[slot] ? fmtPence(DATA.rateProfile[slot]) : "—"]);
      })
    );
  }

  /* -- heatmap ------------------------------------------------------------ */

  function renderHeatmap(rows) {
    var card = root.querySelector("[data-card='heatmap']");
    var host = card.querySelector("[data-plot]");

    var steps = [
      cssVar("--heat-0"), cssVar("--heat-1"), cssVar("--heat-2"), cssVar("--heat-3"),
      cssVar("--heat-4"), cssVar("--heat-5"), cssVar("--heat-6")
    ];

    var index = {};
    DATA.halfHourly.dates.forEach(function (date, i) { index[date] = i; });

    var visible = rows.filter(function (day) { return index[day.date] !== undefined; });
    if (!visible.length) return;

    var values = [];
    visible.forEach(function (day) {
      DATA.halfHourly.slots[index[day.date]].forEach(function (value) { values.push(value); });
    });

    // Cap the ramp at the 98th percentile so one spike doesn't flatten the map.
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var ceiling = sorted[Math.floor(sorted.length * 0.98)] || 1;

    var rowH = Math.max(3, Math.min(11, 340 / visible.length));
    var margin = { top: 8, right: 12, bottom: 30, left: 46 };
    var height = Math.round(visible.length * rowH) + margin.top + margin.bottom;

    var f = frame(host, {
      height: height,
      margin: margin,
      label: "Electricity use by day and time of day"
    });

    var colW = f.plotW / SLOTS;

    var bucket = function (value) {
      if (value <= 0.0001) return 0;
      var ratio = Math.min(1, value / ceiling);
      return Math.min(steps.length - 1, 1 + Math.floor(ratio * (steps.length - 1.001)));
    };

    visible.forEach(function (day, row) {
      var slots = DATA.halfHourly.slots[index[day.date]];
      var y = f.top + row * rowH;

      slots.forEach(function (value, slot) {
        f.svg.appendChild(el("rect", {
          x: f.left + slot * colW,
          y: y,
          width: Math.max(1, colW - 0.5),
          height: Math.max(1, rowH - 0.5),
          fill: steps[bucket(value)]
        }));
      });

      var hit = el("rect", {
        x: f.left, y: y, width: f.plotW, height: rowH, class: "energy-hit"
      });
      hit.addEventListener("pointermove", function (event) {
        var box = f.svg.getBoundingClientRect();
        var slot = Math.max(0, Math.min(SLOTS - 1, Math.floor((event.clientX - box.left - f.left) / colW)));
        showTooltip(
          tooltipRows(fmtDate(day.date) + " · " + fmtSlot(slot), [
            { label: "Electricity", value: fmtKwh(slots[slot], 3), color: cssVar("--elec") },
            { label: "Day total", value: fmtKwh(day.ek) }
          ]),
          event
        );
      });
      hit.addEventListener("pointerleave", hideTooltip);
      f.svg.appendChild(hit);
    });

    var labelEvery = Math.max(1, Math.round(visible.length / 8));
    visible.forEach(function (day, row) {
      if (row % labelEvery !== 0) return;
      f.svg.appendChild(el("text", {
        x: f.left - 8,
        y: f.top + row * rowH + rowH / 2 + 3,
        "text-anchor": "end",
        class: "energy-tick"
      }, fmtDayMonth(day.date)));
    });

    [0, 12, 24, 36, 47].forEach(function (slot) {
      f.svg.appendChild(el("text", {
        x: f.left + slot * colW + colW / 2,
        y: f.top + visible.length * rowH + 20,
        "text-anchor": slot === 0 ? "start" : slot === 47 ? "end" : "middle",
        class: "energy-tick"
      }, fmtSlot(slot)));
    });

    var legend = card.querySelector("[data-scale]");
    if (legend) {
      legend.innerHTML =
        "<span>Less</span><span class=\"energy-scale-steps\">" +
        steps.map(function (colour) {
          return '<span class="energy-scale-step" style="background:' + colour +
            ';box-shadow:inset 0 0 0 1px var(--hairline)"></span>';
        }).join("") +
        "</span><span>More — up to " + fmtKwh(ceiling, 2) + " per half hour</span>";
    }

    tableView(
      card,
      ["Day", "Overnight 00–06", "Morning 06–12", "Afternoon 12–17", "Evening 17–24", "Peak half hour"],
      visible.slice().reverse().map(function (day) {
        var slots = DATA.halfHourly.slots[index[day.date]];
        var sum = function (from, to) {
          return slots.slice(from, to).reduce(function (a, b) { return a + b; }, 0).toFixed(2);
        };
        var peak = slots.indexOf(Math.max.apply(null, slots));
        return [
          fmtDate(day.date, true),
          sum(0, 12), sum(12, 24), sum(24, 34), sum(34, 48),
          fmtSlot(peak) + " (" + slots[peak].toFixed(2) + ")"
        ];
      })
    );
  }

  /* -- day of week -------------------------------------------------------- */

  function renderDayOfWeek(rows) {
    var card = root.querySelector("[data-card='day-of-week']");
    var host = card.querySelector("[data-plot]");
    var elec = cssVar("--elec");
    var gas = cssVar("--gas");

    var sums = DAY_NAMES.map(function () { return { ek: 0, gk: 0, cost: 0, n: 0 }; });
    rows.forEach(function (day) {
      var bucket = sums[isoDow(day.date)];
      bucket.ek += day.ek;
      bucket.gk += day.gk;
      bucket.cost += day.ec + day.gc + day.sc;
      bucket.n += 1;
    });

    var averages = sums.map(function (bucket) {
      return bucket.n
        ? { ek: bucket.ek / bucket.n, gk: bucket.gk / bucket.n, cost: bucket.cost / bucket.n, n: bucket.n }
        : { ek: 0, gk: 0, cost: 0, n: 0 };
    });

    var f = frame(host, {
      height: 272,
      margin: { top: 28, right: 12, bottom: 34, left: 44 },
      label: "Average energy use by day of the week"
    });

    var max = Math.max.apply(null, averages.map(function (a) { return a.ek + a.gk; }).concat([1]));
    var top = yAxis(f, max, function (value) { return value.toFixed(0); });

    var step = f.plotW / 7;
    var barW = Math.min(48, step - 12);
    var baseline = f.top + f.plotH;
    var peak = averages.reduce(function (best, a, i) {
      return a.ek + a.gk > averages[best].ek + averages[best].gk ? i : best;
    }, 0);

    averages.forEach(function (average, index) {
      var x = f.left + index * step + (step - barW) / 2;
      var elecH = (average.ek / top) * f.plotH;
      var gasH = (average.gk / top) * f.plotH;

      if (elecH > 0.4) {
        f.svg.appendChild(el("path", {
          d: barPath(x, baseline - elecH, barW, elecH, gasH > 2 ? 0 : 4), fill: elec
        }));
      }
      if (gasH > 0.4) {
        var gasBottom = baseline - elecH - (elecH > 0.4 ? 2 : 0);
        f.svg.appendChild(el("path", { d: barPath(x, gasBottom - gasH, barW, gasH, 4), fill: gas }));
      }

      f.svg.appendChild(el("text", {
        x: f.left + index * step + step / 2,
        y: baseline + 20,
        "text-anchor": "middle",
        class: "energy-tick"
      }, DAY_NAMES[index]));

      var hit = el("rect", {
        x: f.left + index * step, y: f.top, width: step, height: f.plotH, class: "energy-hit"
      });
      hit.addEventListener("pointermove", function (event) {
        showTooltip(
          tooltipRows(DAY_NAMES[index] + " average of " + average.n, [
            { label: "Electricity", value: fmtKwh(average.ek), color: elec },
            { label: "Gas", value: fmtKwh(average.gk), color: gas },
            { label: "Cost", value: fmtMoney(average.cost) }
          ]),
          event
        );
      });
      hit.addEventListener("pointerleave", hideTooltip);
      f.svg.appendChild(hit);
    });

    f.svg.appendChild(el("text", { x: 0, y: 12, class: "energy-axis-label" }, "kWh"));

    // The busiest day is called out as a caption — a label on the tallest bar
    // has nowhere to sit, since that bar reaches the top of the scale.
    var caption = card.querySelector("[data-caption]");
    if (caption) {
      caption.textContent =
        "Busiest: " + DAY_NAMES[peak] + ", " + fmtKwh(averages[peak].ek + averages[peak].gk) + " a day";
    }

    tableView(
      card,
      ["Day", "Electricity", "Gas", "Total", "Cost", "Days"],
      averages.map(function (average, index) {
        return [
          DAY_NAMES[index],
          average.ek.toFixed(1),
          average.gk.toFixed(1),
          (average.ek + average.gk).toFixed(1),
          fmtMoney(average.cost),
          String(average.n)
        ];
      })
    );
  }

  /* -- wiring ------------------------------------------------------------- */

  var state = { days: Math.min(30, DATA.days.length) };

  function renderAll() {
    var rows = slice(state.days);
    if (!rows.length) return;

    renderTiles(rows);
    renderDailyEnergy(rows);
    renderDailyCost(rows);
    renderDayShape(rows);
    renderHeatmap(rows);
    renderDayOfWeek(rows);

    var range = root.querySelector("[data-range-summary]");
    if (range) {
      range.textContent = fmtDate(rows[0].date, true) + " – " + fmtDate(rows[rows.length - 1].date, true);
    }
  }

  var buttons = Array.prototype.slice.call(root.querySelectorAll("[data-range]"));
  buttons.forEach(function (button) {
    var days = Number(button.dataset.range);
    if (days > DATA.days.length) {
      button.disabled = true;
      button.title = "Only " + DATA.days.length + " days of readings are available";
      return;
    }

    button.addEventListener("click", function () {
      state.days = days;
      buttons.forEach(function (other) {
        other.setAttribute("aria-pressed", String(other === button));
      });
      renderAll();
    });

    button.setAttribute("aria-pressed", String(days === state.days));
  });

  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderAll, 150);
  });

  renderAll();
})();
