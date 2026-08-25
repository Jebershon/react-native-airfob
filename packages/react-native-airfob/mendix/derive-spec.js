/**
 * Derives the Mendix domain model the JavaScript actions require.
 *
 * Nanoflows cannot call an import mapping — "these activities can only be used
 * in microflows" — and cannot parse JSON either. So the JavaScript actions build
 * Mendix objects directly with mx.data.create, which means the entities have to
 * exist in the domain model with exactly the right attributes.
 *
 * entities/ is the single source of truth for those shapes. This reads it and
 * prints the hand-build checklist, so the domain model cannot quietly diverge
 * from what the actions actually set.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ENTITIES_DIR = path.join(__dirname, "entities");

/**
 * One file per entity. The filename is the entity name, so there is nothing to
 * configure and a new entity cannot be forgotten here.
 */

function typeOf(value) {
  if (typeof value === "boolean") return "Boolean";
  if (typeof value === "number") return Number.isInteger(value) ? "Integer" : "Decimal";
  if (typeof value === "string") return "String";
  return null;
}

/**
 * @param {object} sample
 * @param {string} entityName
 * @param {Record<string,string>} childNames  key -> entity name
 * @returns {{entities: Array, associations: Array}}
 */
function deriveFrom(sample, entityName, childNames = {}) {
  const attributes = [];
  const associations = [];
  const entities = [];
  const problems = [];

  for (const [key, value] of Object.entries(sample)) {
    if (value === null) {
      // Studio Pro cannot infer a type from null and silently drops the
      // attribute, so a null in a sample is a defect, not a style choice.
      problems.push(`${entityName}.${key} is null — the wizard will drop this attribute`);
      continue;
    }

    if (Array.isArray(value)) {
      const childName = childNames[key];
      if (!childName) {
        problems.push(`${entityName}.${key} is an array with no configured entity name`);
        continue;
      }
      if (value.length === 0) {
        problems.push(`${entityName}.${key} is an empty array — nothing to infer`);
        continue;
      }
      // Merge every element so an optional field present in only one of them
      // still produces an attribute.
      const merged = Object.assign({}, ...value);
      const child = deriveFrom(merged, childName);
      entities.push(...child.entities);
      associations.push(
        { name: `${entityName}_${childName}`, from: entityName, to: childName, multiplicity: "1-*" },
        ...child.associations
      );
      problems.push(...child.problems);
      continue;
    }

    if (typeof value === "object") {
      const childName = childNames[key];
      if (!childName) {
        problems.push(`${entityName}.${key} is a nested object with no configured entity name`);
        continue;
      }
      const child = deriveFrom(value, childName);
      entities.push(...child.entities);
      associations.push(
        { name: `${entityName}_${childName}`, from: entityName, to: childName, multiplicity: "1-1" },
        ...child.associations
      );
      problems.push(...child.problems);
      continue;
    }

    const type = typeOf(value);
    if (!type) {
      problems.push(`${entityName}.${key} has an unsupported type`);
      continue;
    }
    attributes.push({ name: key, type });
  }

  return {
    entities: [{ name: entityName, persistable: false, attributes }, ...entities],
    associations,
    problems
  };
}

/** Reads every entity definition and returns the full model. */
function deriveSpec(dir = ENTITIES_DIR) {
  const entities = [];
  const problems = [];

  for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort()) {
    const name = file.replace(/.json$/, "");
    const shape = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    const derived = deriveFrom(shape, name);
    entities.push(...derived.entities);
    problems.push(...derived.problems.map(p => file + ": " + p));
  }

  return { entities, associations: [], problems };
}

function format(spec) {
  const lines = [];

  lines.push("Domain model — all entities non-persistable");
  lines.push("");
  lines.push("The device is the source of truth and access data carries retention");
  lines.push("obligations, so none of this belongs in the database.");
  lines.push("");

  for (const entity of spec.entities) {
    lines.push(`${entity.name}`);
    const width = Math.max(...entity.attributes.map(a => a.name.length), 0);
    for (const attribute of entity.attributes) {
      lines.push(`  ${attribute.name.padEnd(width)}  ${attribute.type}`);
    }
    lines.push("");
  }

  if (spec.associations.length) {
    lines.push("Associations");
    for (const association of spec.associations) {
      lines.push(`  ${association.from} -> ${association.to}  ${association.multiplicity}`);
    }
    lines.push("");
  }

  if (spec.problems.length) {
    lines.push("PROBLEMS");
    spec.problems.forEach(p => lines.push(`  ${p}`));
    lines.push("");
  }

  return lines.join("\n");
}

module.exports = { deriveSpec, deriveFrom, format, ENTITIES_DIR };
