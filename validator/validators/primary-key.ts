/**
 * Primary Key Validator
 *
 * Validates that primary_key format matches the strategy declared in source.yaml:
 * - stable_id: source_id:<field>:<value> (e.g., "finance/fdic:cert:12345")
 * - url: source_id:url:<path> (e.g., "investors/vcsheet:url:/fund/abc")
 * - fingerprint: source_id:fp:<hash> (e.g., "tech_founders/yc:fp:abc123")
 * - url_fingerprint: source_id:<url>:<hash>
 */

import { ValidationError, PrimaryKeyStrategy } from "../types";

export function validatePrimaryKeyFormat(
  primaryKey: string,
  sourceId: string,
  strategy: PrimaryKeyStrategy,
  lineNum: number
): ValidationError[] {
  const errors: ValidationError[] = [];
  const file = "output/leads.jsonl";

  // Primary key must start with source_id
  if (!primaryKey.startsWith(`${sourceId}:`)) {
    errors.push({
      type: "schema",
      file,
      line: lineNum,
      field: "core.primary_key",
      message: `primary_key must start with source_id. Expected '${sourceId}:...', got '${primaryKey}'`,
    });
    return errors;
  }

  const keyWithoutPrefix = primaryKey.slice(sourceId.length + 1);

  switch (strategy.type) {
    case "stable_id": {
      // Format: source_id:field_path:value (e.g., "finance/fdic:cert:12345")
      // The field path should match the last element of stable_id_context_path
      if (!strategy.stable_id_context_path || strategy.stable_id_context_path.length === 0) {
        break; // Can't validate without path info
      }
      const expectedField = strategy.stable_id_context_path[strategy.stable_id_context_path.length - 1];
      const pattern = new RegExp(`^${expectedField}:.+$`);
      if (!pattern.test(keyWithoutPrefix)) {
        errors.push({
          type: "schema",
          file,
          line: lineNum,
          field: "core.primary_key",
          message: `primary_key format mismatch. Strategy is 'stable_id' with path ending in '${expectedField}'. Expected '${sourceId}:${expectedField}:<value>', got '${primaryKey}'`,
        });
      }
      break;
    }

    case "url": {
      // Format: source_id:url:/path (e.g., "investors/vcsheet:url:/fund/abc")
      if (!keyWithoutPrefix.startsWith("url:")) {
        errors.push({
          type: "schema",
          file,
          line: lineNum,
          field: "core.primary_key",
          message: `primary_key format mismatch. Strategy is 'url'. Expected '${sourceId}:url:<path>', got '${primaryKey}'`,
        });
      }
      break;
    }

    case "fingerprint": {
      // Format: source_id:fp:hash (e.g., "tech_founders/yc:fp:abc123")
      if (!keyWithoutPrefix.startsWith("fp:")) {
        errors.push({
          type: "schema",
          file,
          line: lineNum,
          field: "core.primary_key",
          message: `primary_key format mismatch. Strategy is 'fingerprint'. Expected '${sourceId}:fp:<hash>', got '${primaryKey}'`,
        });
      }
      break;
    }

    case "url_fingerprint": {
      // Format: source_id:url:hash (e.g., "source:url:abc123")
      // This is URL + hash for disambiguation
      const parts = keyWithoutPrefix.split(":");
      if (parts.length < 2) {
        errors.push({
          type: "schema",
          file,
          line: lineNum,
          field: "core.primary_key",
          message: `primary_key format mismatch. Strategy is 'url_fingerprint'. Expected '${sourceId}:<url>:<hash>', got '${primaryKey}'`,
        });
      }
      break;
    }
  }

  return errors;
}
