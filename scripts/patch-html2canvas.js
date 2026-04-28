#!/usr/bin/env node
/**
 * patch-html2canvas.js — Postinstall script to patch html2canvas v1.4.1
 * to support oklch()/lab()/lch()/color() color functions used by Tailwind CSS v4.
 *
 * Run manually: node scripts/patch-html2canvas.js
 * Or via: npm postinstall / bun run postinstall
 */

const fs = require("fs");
const path = require("path");

const FILE = path.join(
  __dirname,
  "..",
  "node_modules",
  "html2canvas",
  "dist",
  "html2canvas.js"
);

const MARKER = "// oklch() support patch for Tailwind CSS v4 compatibility";

function patch() {
  if (!fs.existsSync(FILE)) {
    console.log("  html2canvas.js not found, skipping patch.");
    return;
  }

  let content = fs.readFileSync(FILE, "utf8");

  if (content.includes(MARKER)) {
    console.log("  html2canvas is already patched.");
    return;
  }

  // The oklch/lch/lab/color handler functions
  const handlers = `
    // oklch() support patch for Tailwind CSS v4 compatibility
    var oklch = function (_context, args) {
        var tokens = args.filter(nonFunctionArgSeparator);
        var l = tokens[0], c = tokens[1], h = tokens[2], alpha = tokens[3];
        var L = getTokenColorValue(l, 0) / 1;
        var C = getTokenColorValue(c, 0) / 1;
        var H = (getTokenColorValue(h, 0)) * Math.PI / 180;
        var a = typeof alpha !== 'undefined' ? getAbsoluteValue(alpha, 1) : 1;
        var ok_a = C * Math.cos(H), ok_b = C * Math.sin(H);
        var l_ = L + 0.3963377774 * ok_a + 0.2158037573 * ok_b;
        var m_ = L - 0.1055613458 * ok_a - 0.0638541728 * ok_b;
        var s_ = L - 0.0894841775 * ok_a - 1.291485548 * ok_b;
        var l3 = l_ * l_ * l_, m3 = m_ * m_ * m_, s3 = s_ * s_ * s_;
        var lr = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
        var lg = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
        var lb = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;
        var toS = function(v) { var cl = Math.max(0, Math.min(1, v)); return cl <= 0.0031308 ? 12.92 * cl : 1.055 * Math.pow(cl, 1/2.4) - 0.055; };
        return pack(Math.round(toS(lr) * 255), Math.round(toS(lg) * 255), Math.round(toS(lb) * 255), a);
    };
    var lab = function (_context, args) {
        var tokens = args.filter(nonFunctionArgSeparator);
        var lV = tokens[0], aV = tokens[1], bV = tokens[2], alpha = tokens[3];
        var l100 = getTokenColorValue(lV, 0), aVal = getTokenColorValue(aV, 0), bVal = getTokenColorValue(bV, 0);
        var a = typeof alpha !== 'undefined' ? getAbsoluteValue(alpha, 1) : 1;
        var fy = (l100 + 16) / 116, fx = aVal / 500 + fy, fz = fy - bVal / 200;
        var d = 6/29, d2 = d*d;
        var toL = function(v) { return v > d ? v*v*v : (v - 16/116) * 3 * d2; };
        var xr = toL(fx)*0.95047, yr = toL(fy), zr = toL(fz)*1.08883;
        var rl = xr*3.2404542 + yr*-1.5371385 + zr*-0.4985314;
        var gl = xr*-0.9692660 + yr*1.8760108 + zr*0.0415560;
        var bl = xr*0.0556434 + yr*-0.2040259 + zr*1.0572252;
        var toS = function(v) { var cl = Math.max(0, Math.min(1, v)); return cl <= 0.0031308 ? 12.92 * cl : 1.055 * Math.pow(cl, 1/2.4) - 0.055; };
        return pack(Math.round(toS(rl) * 255), Math.round(toS(gl) * 255), Math.round(toS(bl) * 255), a);
    };
    var lch = function (_context, args) { return oklch(_context, args); };
    var color = function (_context, args) { return oklch(_context, args); };
    var SUPPORTED_COLOR_FUNCTIONS = {
        hsl: hsl, hsla: hsl, rgb: rgb, rgba: rgb,
        oklch: oklch, oklab: lab, lab: lab, lch: lch, color: color
    };`;

  const oldTable = `var SUPPORTED_COLOR_FUNCTIONS = {
        hsl: hsl,
        hsla: hsl,
        rgb: rgb,
        rgba: rgb
    };`;

  if (!content.includes(oldTable)) {
    console.log("  WARNING: Could not find SUPPORTED_COLOR_FUNCTIONS target. html2canvas version may have changed.");
    return;
  }

  content = content.replace(oldTable, handlers);
  fs.writeFileSync(FILE, content, "utf8");
  console.log("  html2canvas patched successfully (oklch/lab/lch support added).");
}

patch();
