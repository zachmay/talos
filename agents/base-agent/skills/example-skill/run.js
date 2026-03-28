#!/usr/bin/env node
const args = process.argv.slice(2);
const message = args.join(" ") || "(no arguments)";
console.log(`[example-skill]: ${message}`);
