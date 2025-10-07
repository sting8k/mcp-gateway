import Ajv from "ajv";
import addFormats from "ajv-formats";
import { ERROR_CODES } from "./types.js";
import { getLogger } from "./logging.js";
const logger = getLogger();
export class ValidationError extends Error {
    code;
    errors;
    constructor(message, errors) {
        super(message);
        this.name = "ValidationError";
        this.code = ERROR_CODES.ARG_VALIDATION_FAILED;
        this.errors = errors;
    }
}
export class Validator {
    ajv;
    constructor() {
        this.ajv = new Ajv({
            strict: false, // Changed to false to allow unknown formats
            allErrors: true,
            verbose: true,
        });
        // Add support for standard formats like date, date-time, email, etc.
        addFormats(this.ajv);
    }
    validate(schema, data, context) {
        logger.debug("Validating arguments", {
            package_id: context?.package_id,
            tool_id: context?.tool_id,
            schema_keys: schema ? Object.keys(schema) : [],
            data_keys: typeof data === "object" && data ? Object.keys(data) : [],
        });
        if (!schema) {
            throw new ValidationError("Schema is required", []);
        }
        // Compile schema with better error handling for format issues
        let validate;
        try {
            validate = this.ajv.compile(schema);
        }
        catch (error) {
            logger.warn("Schema compilation warning", {
                package_id: context?.package_id,
                tool_id: context?.tool_id,
                error: error instanceof Error ? error.message : String(error),
                hint: "This might be due to custom formats in the schema"
            });
            // Re-throw to maintain existing behavior
            throw error;
        }
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
            throw new ValidationError(`Argument validation failed: ${errors.map(e => `${e.instancePath || "root"}: ${e.message}`).join(", ")}`, errors);
        }
        logger.debug("Validation passed", {
            package_id: context?.package_id,
            tool_id: context?.tool_id,
        });
    }
}
let validator;
export function getValidator() {
    if (!validator) {
        validator = new Validator();
    }
    return validator;
}
