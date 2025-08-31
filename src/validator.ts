import Ajv from "ajv";
import { ERROR_CODES } from "./types.js";
import { getLogger } from "./logging.js";

const logger = getLogger();

export class ValidationError extends Error {
  code: number;
  errors: any[];
  
  constructor(message: string, errors: any[]) {
    super(message);
    this.name = "ValidationError";
    this.code = ERROR_CODES.ARG_VALIDATION_FAILED;
    this.errors = errors;
  }
}

export class Validator {
  private ajv: Ajv;

  constructor() {
    this.ajv = new Ajv({
      strict: true,
      allErrors: true,
      verbose: true,
    });
  }

  validate(schema: any, data: any, context?: { package_id?: string; tool_id?: string }): void {
    logger.debug("Validating arguments", {
      package_id: context?.package_id,
      tool_id: context?.tool_id,
      schema_keys: schema ? Object.keys(schema) : [],
      data_keys: typeof data === "object" && data ? Object.keys(data) : [],
    });

    if (!schema) {
      throw new ValidationError("Schema is required", []);
    }

    const validate = this.ajv.compile(schema);
    const valid = validate(data);

    if (!valid) {
      const errors = validate.errors || [];
      logger.warn("Validation failed", {
        package_id: context?.package_id,
        tool_id: context?.tool_id,
        errors: errors.map(err => ({
          instancePath: err.instancePath,
          schemaPath: err.schemaPath,
          keyword: err.keyword,
          message: err.message,
        })),
      });

      throw new ValidationError(
        `Argument validation failed: ${errors.map(e => `${e.instancePath || "root"}: ${e.message}`).join(", ")}`,
        errors
      );
    }

    logger.debug("Validation passed", {
      package_id: context?.package_id,
      tool_id: context?.tool_id,
    });
  }
}

let validator: Validator;

export function getValidator(): Validator {
  if (!validator) {
    validator = new Validator();
  }
  return validator;
}