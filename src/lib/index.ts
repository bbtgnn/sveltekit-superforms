import SuperDebug from './client/SuperDebug.svelte';

export default SuperDebug;

export { SuperFormError, SchemaError } from './errors.js';
export type { InputConstraints, InputConstraint } from '$lib/jsonSchema/constraints.js';

// Everything from client/index.ts
export {
	superForm,
	intProxy,
	numberProxy,
	booleanProxy,
	dateProxy,
	fieldProxy,
	formFieldProxy,
	stringProxy,
	arrayProxy,
	defaults,
	actionResult,
	defaultValues,
	superValidate,
	message,
	setMessage,
	setError,
	removeFiles,
	failAndRemoveFiles,
	type SuperValidated,
	type TaintedFields,
	type ValidationErrors,
	type Infer,
	type FormResult,
	type FormOptions,
	type SuperForm,
	type SuperFormEventList,
	type SuperFormEvents,
	type SuperFormSnapshot,
	type ValidateOptions,
	type TaintOption,
	type FormPath,
	type FormPathLeaves,
	type FormPathArrays,
	type FormPathType
} from './client/index.js';
