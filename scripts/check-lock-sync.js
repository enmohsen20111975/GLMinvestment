#!/usr/bin/env node
// Compares package.json dependencies against package-lock.json so `npm ci`
// won't fail with "lock file out of sync" before touching node_modules.
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));

const fromPkg = Object.keys(pkg.dependencies || {}).sort();
const fromLock = Object.keys((lock.packages && lock.packages[""] && lock.packages[""].dependencies) || {}).sort();

const missingInLock = fromPkg.filter((d) => !fromLock.includes(d));
const missingInPkg = fromLock.filter((d) => !fromPkg.includes(d));

console.log("lockfileVersion:", lock.lockfileVersion);
console.log("deps in package.json:", fromPkg.length);
console.log("deps in lock root:", fromLock.length);
console.log("in package.json but NOT in lock:", missingInLock);
console.log("in lock but NOT in package.json:", missingInPkg);
