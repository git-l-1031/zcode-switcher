import { readFileSync } from "node:fs";

const tag = process.argv[2] || "";
const version = tag.replace(/^v/i, "");
const changelog = readFileSync("docs/changelog.md", "utf8");
const lines = changelog.split(/\r?\n/);
const start = lines.findIndex((line) => line.trim() === `## ${version}`);
const next = lines.findIndex(
  (line, index) => index > start && line.startsWith("## ")
);
const section =
  start === -1
    ? []
    : lines.slice(start + 1, next === -1 ? lines.length : next);
const notes = section.filter((line) => line.trim()).join("\n").trim();

console.log(notes || `ZCode Switcher release ${tag || version}`);
