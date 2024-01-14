import { traversePath } from './traversal.js';
import { type ActionFailure, fail as realFail, type RequestEvent } from '@sveltejs/kit';
import { type ValidationAdapter, type ValidationResult } from './adapters/adapters.js';
import { parseRequest } from './formData.js';
import type { NumericRange } from './utils.js';
import { splitPath, type StringPathLeaves } from './stringPath.js';
import type { JSONSchema } from './jsonSchema/index.js';
import { mapErrors, mergeDefaults, replaceInvalidDefaults } from './errors.js';
import type { InputConstraints } from '$lib/jsonSchema/constraints.js';
import type { SuperStructArray } from './superStruct.js';
import type { SchemaShape } from './jsonSchema/schemaShape.js';

export type SuperValidated<
	Out extends Record<string, unknown>,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	Message = App.Superforms.Message extends never ? any : App.Superforms.Message
> = {
	id: string;
	valid: boolean;
	posted: boolean;
	errors: ValidationErrors<Out>;
	data: Out;
	constraints: InputConstraints<Out>;
	message?: Message;
	shape?: SchemaShape;
};

export type ValidationErrors<Out extends Record<string, unknown>> = {
	_errors?: string[];
} & SuperStructArray<Out, string[], { _errors?: string[] }>;

export type SuperValidateSyncData<In extends Record<string, unknown>> =
	| Partial<In>
	| null
	| undefined;

export type SuperValidateSyncOptions<Out extends Record<string, unknown>> = Pick<
	SuperValidateOptions<Out>,
	'id' | 'defaults' | 'jsonSchema'
>;

type SuperValidateData<In extends Record<string, unknown>> =
	| RequestEvent
	| Request
	| FormData
	| URLSearchParams
	| URL
	| SuperValidateSyncData<In>;

export type SuperValidateOptions<Out extends Record<string, unknown>> = Partial<{
	errors: boolean;
	id: string;
	preprocessed: (keyof Out)[];
	defaults: Out;
	jsonSchema: JSONSchema;
	strict: boolean;
	allowFiles: boolean;
}>;

export type TaintedFields<T extends Record<string, unknown>> = SuperStructArray<T, boolean>;

/////////////////////////////////////////////////////////////////////

export async function superValidate<
	Out extends Record<string, unknown>,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	Message = App.Superforms.Message extends never ? any : App.Superforms.Message
>(
	adapter: ValidationAdapter<Out>,
	options?: SuperValidateOptions<Out>
): Promise<SuperValidated<Out, Message>>;

export async function superValidate<
	Out extends Record<string, unknown>,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	M = App.Superforms.Message extends never ? any : App.Superforms.Message,
	In extends Record<string, unknown> = Out
>(
	data: SuperValidateData<In>,
	adapter: ValidationAdapter<Out>,
	options?: SuperValidateOptions<Out>
): Promise<SuperValidated<Out, M>>;

/**
 * Validates a schema for data validation and usage in superForm.
 * @param data Data corresponding to a schema, or RequestEvent/FormData/URL. If falsy, the schema's default values will be used.
 * @param schema The schema to validate against.
 */
export async function superValidate<
	Out extends Record<string, unknown>,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	Message = App.Superforms.Message extends never ? any : App.Superforms.Message,
	In extends Record<string, unknown> = Out
>(
	data: ValidationAdapter<Out> | SuperValidateData<In>,
	adapter?: ValidationAdapter<Out> | SuperValidateData<In> | SuperValidateOptions<Out>,
	options?: SuperValidateOptions<Out>
): Promise<SuperValidated<Out, Message>> {
	if (data && 'superFormValidationLibrary' in data) {
		options = adapter as SuperValidateOptions<Out>;
		adapter = data;
		data = undefined;
	}

	const validator = adapter as ValidationAdapter<Out>;

	const defaults = options?.defaults ?? validator.defaults;
	const jsonSchema = validator.jsonSchema;

	const parsed = await parseRequest<Out>(data, jsonSchema, options);
	const addErrors = options?.errors ?? (options?.strict ? true : !!parsed.data);

	// Merge with defaults in non-strict mode.
	const parsedData = options?.strict ? parsed.data ?? {} : mergeDefaults(parsed.data, defaults);

	let status: ValidationResult<Out>;

	if (!!parsed.data || addErrors) {
		status = await /* @__PURE__ */ validator.validate(parsedData);
	} else {
		status = { success: false, issues: [] };
	}

	const valid = status.success;
	const errors = valid || !addErrors ? {} : mapErrors(status.issues, validator.shape);

	// Final data should always have defaults, to ensure type safety
	//const dataWithDefaults = { ...defaults, ...(valid ? status.data : parsedData) };
	const dataWithDefaults = valid
		? status.data
		: replaceInvalidDefaults(
				options?.strict ? mergeDefaults(parsedData, defaults) : parsedData,
				defaults,
				jsonSchema,
				status.issues,
				options?.preprocessed
			);

	let outputData: Record<string, unknown>;
	if (jsonSchema.additionalProperties === false) {
		// Strip keys not belonging to schema
		outputData = {};
		for (const key of Object.keys(jsonSchema.properties ?? {})) {
			if (key in dataWithDefaults) outputData[key] = dataWithDefaults[key];
		}
	} else {
		outputData = dataWithDefaults;
	}

	const output: SuperValidated<Out, Message> = {
		id: parsed.id ?? options?.id ?? validator.id,
		valid,
		posted: parsed.posted,
		errors: errors as ValidationErrors<Out>,
		data: outputData as Out,
		constraints: validator.constraints
	};

	if (Object.keys(validator.shape).length) {
		output.shape = validator.shape;
	}

	return output;
}

/////////////////////////////////////////////////////////////////////

/**
 * Sends a message with a form, with an optional HTTP status code that will set
 * form.valid to false if status >= 400. A status lower than 400 cannot be sent.
 */
export function message<T extends Record<string, unknown>, M>(
	form: SuperValidated<T, M>,
	message: M,
	options?: {
		status?: NumericRange<400, 599>;
		removeFiles?: boolean;
	}
) {
	if (options?.status && options.status >= 400) {
		form.valid = false;
	}

	form.message = message;

	const remove = options?.removeFiles !== false;
	if (form.valid) return remove ? removeFiles({ form }) : { form };

	const func = remove ? failAndRemoveFiles : realFail;
	return func(options?.status ?? 400, { form });
}

export const setMessage = message;

type SetErrorOptions = {
	overwrite?: boolean;
	status?: NumericRange<400, 599>;
	removeFiles?: boolean;
};

/**
 * Sets a form-level error.
 * form.valid is automatically set to false.
 *
 * @param {SuperValidated<T, unknown>} form A validation object, usually returned from superValidate.
 * @param {string | string[]} error Error message(s).
 * @param {SetErrorOptions} options Option to overwrite previous errors and set a different status than 400. The status must be in the range 400-599.
 * @returns fail(status, { form })
 */
export function setError<T extends Record<string, unknown>>(
	form: SuperValidated<T, unknown>,
	error: string | string[],
	options?: SetErrorOptions
): ActionFailure<{ form: SuperValidated<T, unknown> }>;

/**
 * Sets an error for a form field or array field.
 * form.valid is automatically set to false.
 *
 * @param {SuperValidated<T, unknown>} form A validation object, usually returned from superValidate.
 * @param {'' | StringPathLeaves<T, '_errors'>} path Path to the form field. Use an empty string to set a form-level error. Array-level errors can be set by appending "._errors" to the field.
 * @param {string | string[]} error Error message(s).
 * @param {SetErrorOptions} options Option to overwrite previous errors and set a different status than 400. The status must be in the range 400-599.
 * @returns fail(status, { form })
 */
export function setError<T extends Record<string, unknown>>(
	form: SuperValidated<T, unknown>,
	path: '' | StringPathLeaves<T, '_errors'>,
	error: string | string[],
	options?: SetErrorOptions
): ActionFailure<{ form: SuperValidated<T, unknown> }>;

export function setError<T extends Record<string, unknown>>(
	form: SuperValidated<T, unknown>,
	path: string | string[] | StringPathLeaves<T, '_errors'>,
	error?: string | string[] | SetErrorOptions,
	options?: SetErrorOptions
): ActionFailure<{ form: SuperValidated<T, unknown> }> {
	// Unify signatures
	if (error == undefined || (typeof error !== 'string' && !Array.isArray(error))) {
		options = error;
		error = path;
		path = '';
	}

	if (options === undefined) options = {};

	const errArr = Array.isArray(error) ? error : [error];

	if (!form.errors) form.errors = {};

	if (path === null || path === '') {
		if (!form.errors._errors) form.errors._errors = [];
		form.errors._errors = options.overwrite ? errArr : form.errors._errors.concat(errArr);
	} else {
		const realPath = splitPath(path as string);

		const leaf = traversePath(form.errors, realPath, ({ parent, key, value }) => {
			if (value === undefined) parent[key] = {};
			return parent[key];
		});

		if (leaf) {
			leaf.parent[leaf.key] =
				Array.isArray(leaf.value) && !options.overwrite ? leaf.value.concat(errArr) : errArr;
		}
	}

	form.valid = false;

	const func = options.removeFiles === false ? realFail : failAndRemoveFiles;
	return func(options.status ?? 400, { form });
}

export function removeFiles<T extends object>(obj: T) {
	if (typeof obj !== 'object') return obj;
	for (const key in obj) {
		const value = obj[key];
		if (value instanceof File) delete obj[key];
		else if (value && typeof value === 'object') removeFiles(value);
	}
	return obj;
}

export function failAndRemoveFiles<T extends Record<string, unknown> | undefined>(
	...params: Parameters<typeof realFail<T>>
) {
	if (params[1]) params[1] = removeFiles(params[1]);
	return realFail<T>(...params);
}
