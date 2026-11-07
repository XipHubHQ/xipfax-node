import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { API_VERSION } from '../src/index.js';

/**
 * The API's document, as this repository holds it and generates the SDK from, and a reading of a
 * request, or an answer, against it: the operation it is, and what in it the document refuses.
 */

interface Parameter {
  name: string;
  in: 'query' | 'header' | 'path' | 'cookie';
  required?: boolean;
}

type Reference = { $ref: string };

export interface Operation {
  operationId: string;
  parameters?: Array<Parameter | Reference>;
  requestBody?: Reference | { content: Record<string, unknown> };
  responses: Record<string, unknown>;
}

interface ApiDocument {
  info: { version: string };
  servers: Array<{ url: string }>;
  paths: Record<string, Record<string, unknown>>;
}

export const apiDocument = JSON.parse(
  readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'),
) as ApiDocument;

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/** Every operation the document names, with its path and method. */
export const operations = Object.entries(apiDocument.paths).flatMap(([path, item]) =>
  METHODS.filter((method) => item[method]).map((method) => ({
    path,
    method,
    operation: item[method] as Operation,
  })),
);

const server = new URL(apiDocument.servers[0]!.url);
const base = server.pathname.replace(/\/$/, '');

/** An Ajv reference to a place in the document, which keeps its own `$ref`s resolving in it. */
function pointer(parts: ReadonlyArray<string | number>): string {
  const escaped = parts.map((part) =>
    encodeURIComponent(String(part).replaceAll('~', '~0').replaceAll('/', '~1')),
  );
  return `openapi#/${escaped.join('/')}`;
}

/** The value at `parts`, following a `$ref` it holds, with the place it was found. */
function at(parts: ReadonlyArray<string | number>): {
  value: unknown;
  parts: Array<string | number>;
} {
  let value: unknown = apiDocument;
  for (const part of parts) value = (value as Record<string | number, unknown>)[part];
  const ref = (value as Partial<Reference> | undefined)?.$ref;
  if (typeof ref !== 'string') return { value, parts: [...parts] };
  return at(
    ref
      .replace(/^#\//, '')
      .split('/')
      .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~')),
  );
}

interface Declared {
  parameter: Parameter;
  schema: string;
}

/** An operation's parameters, the path's and its own, the operation's winning a name both give. */
export function parametersOf(path: string, method: string): Declared[] {
  const declared = new Map<string, Declared>();
  for (const owner of [
    ['paths', path],
    ['paths', path, method],
  ]) {
    const list = (at([...owner, 'parameters']).value ?? []) as unknown[];
    list.forEach((_, index) => {
      const found = at([...owner, 'parameters', index]);
      const parameter = found.value as Parameter;
      declared.set(`${parameter.in}:${parameter.name.toLowerCase()}`, {
        parameter,
        schema: pointer([...found.parts, 'schema']),
      });
    });
  }
  return [...declared.values()];
}

const options = { strict: false, validateFormats: false, allErrors: true } as const;
const bodies = new Ajv2020(options);
bodies.addSchema(apiDocument, 'openapi');
// A query, a header and a path carry text: each is read as its schema's type before it's checked.
const texts = new Ajv2020({ ...options, coerceTypes: true });
texts.addSchema(apiDocument, 'openapi');

/** What in `value` the schema at `schema` refuses; none where it fits. */
function refused(schema: string, value: unknown, text = false): string[] {
  const validate = text
    ? texts.compile({
        type: 'object',
        properties: { value: { $ref: schema } },
        required: ['value'],
      })
    : bodies.compile({ $ref: schema });
  if (validate(text ? { value } : value)) return [];
  return (validate.errors ?? []).map((error) => `${error.instancePath} ${error.message}`);
}

/** The text `Xip-Version` takes, as the document gives it, refused where it isn't `version`. */
export function versionRefused(path: string, method: string, version: string): string[] {
  const declared = parametersOf(path, method).find(
    ({ parameter }) => parameter.in === 'header' && parameter.name === 'Xip-Version',
  );
  return declared ? refused(declared.schema, version, true) : ['takes no Xip-Version'];
}

/** The operation a request is, by its method and path on the document's server. */
function operationOf(request: Request) {
  const url = new URL(request.url);
  if (url.origin !== server.origin) return undefined;
  for (const candidate of operations) {
    if (candidate.method !== request.method.toLowerCase()) continue;
    const names: string[] = [];
    const template = `${base}${candidate.path}`.replace(/\{([^}]+)\}/g, (_, name: string) => {
      names.push(name);
      return '([^/]+)';
    });
    const match = new RegExp(`^${template}$`).exec(url.pathname);
    if (!match) continue;
    const pathValues = new Map(
      names.map((name, index) => [name, decodeURIComponent(match[index + 1]!)]),
    );
    return { ...candidate, url, pathValues };
  }
  return undefined;
}

/**
 * A request read against the document: the operation it is, and each thing in it the document
 * refuses, from its address, its key and its version to each parameter and its body.
 */
export async function readRequest(
  request: Request,
): Promise<{ operationId: string | undefined; refused: string[] }> {
  const found = operationOf(request);
  if (!found) {
    return {
      operationId: undefined,
      refused: [`${request.method} ${request.url} is no operation of the document`],
    };
  }
  const { path, method, operation, url, pathValues } = found;
  const problems: string[] = [];

  if (!/^Bearer \S+$/.test(request.headers.get('Authorization') ?? '')) {
    problems.push('Authorization is no bearer key');
  }
  if (request.headers.get('Xip-Version') !== API_VERSION) {
    problems.push(`Xip-Version is ${request.headers.get('Xip-Version')}, not ${API_VERSION}`);
  }

  const declared = parametersOf(path, method);
  for (const { parameter, schema } of declared) {
    const value =
      parameter.in === 'query'
        ? url.searchParams.get(parameter.name)
        : parameter.in === 'header'
          ? request.headers.get(parameter.name)
          : parameter.in === 'path'
            ? (pathValues.get(parameter.name) ?? null)
            : null;
    if (value === null) {
      if (parameter.required) problems.push(`${parameter.in} ${parameter.name} is missing`);
      continue;
    }
    for (const problem of refused(schema, value, true)) {
      problems.push(`${parameter.in} ${parameter.name}: ${problem}`);
    }
  }
  const queryNames = new Set(
    declared
      .filter(({ parameter }) => parameter.in === 'query')
      .map(({ parameter }) => parameter.name),
  );
  for (const name of url.searchParams.keys()) {
    if (!queryNames.has(name)) problems.push(`query ${name} is no parameter of the operation`);
  }

  const body = await request.clone().text();
  if (operation.requestBody) {
    const requestBody = at(['paths', path, method, 'requestBody']);
    if (!/^application\/json/.test(request.headers.get('Content-Type') ?? '')) {
      problems.push('the body is not sent as JSON');
    }
    const schema = pointer([...requestBody.parts, 'content', 'application/json', 'schema']);
    for (const problem of refused(schema, JSON.parse(body))) problems.push(`body: ${problem}`);
  } else if (body !== '') {
    problems.push('a body the operation takes none of');
  }

  return { operationId: operation.operationId, refused: problems };
}

/** An answer read against the document: what in it the operation's answer for `status` refuses. */
export function readAnswer(request: Request, status: number, body: unknown): string[] {
  const found = operationOf(request);
  if (!found) return [`${request.method} ${request.url} is no operation of the document`];
  const answer = at(['paths', found.path, found.method, 'responses', String(status)]);
  if (answer.value === undefined) return [`${found.operation.operationId} gives no ${status}`];
  const content = (answer.value as { content?: Record<string, unknown> }).content;
  if (!content) return body === undefined ? [] : [`${status} carries no body`];
  return refused(pointer([...answer.parts, 'content', 'application/json', 'schema']), body);
}
