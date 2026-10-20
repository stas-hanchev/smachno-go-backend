import Joi from 'joi';
import joiToJsonModule from 'joi-to-json';

type JoiToJson = (schema: Joi.Schema, mode: 'open-api') => Record<string, unknown>;
const joiToJson = ((joiToJsonModule as unknown as { default?: JoiToJson }).default ??
  joiToJsonModule) as unknown as JoiToJson;

type Handler = ((...args: unknown[]) => unknown) & {
  stack?: Layer[];
  _schema?: Record<string, unknown>;
};

interface Layer {
  handle: Handler;
  route?: {
    path: string | string[];
    methods: Record<string, boolean>;
    stack: { handle: Handler }[];
  };
}

export interface RouterMount {
  path: string;
  router: { stack: unknown[] };
  tag: string;
}

type JsonSchema = Record<string, unknown>;

interface Operation {
  tags: string[];
  summary: string;
  parameters?: JsonSchema[];
  requestBody?: JsonSchema;
  security?: Record<string, string[]>[];
  responses: Record<string, unknown>;
}

const SEGMENT_PARAMS: Record<string, string> = {
  params: 'path',
  query: 'query',
  headers: 'header',
};

function toJsonSchema(value: unknown): JsonSchema {
  const schema = Joi.isSchema(value) ? value : Joi.object(value as Joi.SchemaMap);
  return joiToJson(schema as Joi.Schema, 'open-api');
}

function toParameters(segment: string, value: unknown): JsonSchema[] {
  const location = SEGMENT_PARAMS[segment];
  if (!location) return [];
  const schema = toJsonSchema(value);
  const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((schema.required ?? []) as string[]);
  return Object.entries(properties).map(([name, property]) => ({
    name,
    in: location,
    required: location === 'path' || required.has(name),
    schema: property,
  }));
}

function openApiPath(path: string): string {
  return path.replace(/:(\w+)/g, '{$1}');
}

function handlerName(handler: Handler): string {
  return handler.name;
}

function collect(
  layers: Layer[],
  prefix: string,
  tag: string,
  secured: boolean,
  paths: Record<string, Record<string, Operation>>,
): void {
  let routerSecured = secured;
  for (const layer of layers) {
    if (!layer.route) {
      if (handlerName(layer.handle) === 'requireAuth') routerSecured = true;
      if (Array.isArray(layer.handle.stack)) {
        collect(layer.handle.stack, prefix, tag, routerSecured, paths);
      }
      continue;
    }
    const routePaths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
    const handlers = layer.route.stack.map((s) => s.handle);
    const rules = handlers.find((h) => h._schema)?._schema ?? {};
    const names = handlers.map(handlerName);
    const authRequired = routerSecured || names.includes('requireAuth');
    const authOptional = names.includes('optionalAuth');

    for (const routePath of routePaths) {
      const fullPath = openApiPath(`${prefix}${routePath === '/' ? '' : routePath}`) || '/';
      for (const method of Object.keys(layer.route.methods)) {
        if (method === '_all') continue;
        const parameters = Object.entries(rules).flatMap(([segment, value]) =>
          toParameters(segment, value),
        );
        const operation: Operation = {
          tags: [tag],
          summary: `${method.toUpperCase()} ${fullPath}`,
          responses: {
            default: {
              description: 'Error',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
            '2XX': { description: 'Success' },
          },
        };
        if (parameters.length) operation.parameters = parameters;
        if (rules.body) {
          operation.requestBody = {
            required: true,
            content: { 'application/json': { schema: toJsonSchema(rules.body) } },
          };
        }
        if (authRequired) operation.security = [{ bearerAuth: [] }];
        else if (authOptional) operation.security = [{}, { bearerAuth: [] }];
        paths[fullPath] ??= {};
        paths[fullPath][method] = operation;
      }
    }
  }
}

export function generateOpenApi(mounts: RouterMount[], basePath: string, version: string) {
  const paths: Record<string, Record<string, Operation>> = {};
  for (const mount of mounts) {
    const prefix = `${basePath}${mount.path === '/' ? '' : mount.path}`;
    collect(mount.router.stack as Layer[], prefix, mount.tag, false, paths);
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'SmachnoGo API',
      version,
      description:
        'Generated from Express routes and celebrate schemas. Money is a string with two decimals, time is ISO 8601 UTC.',
    },
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                details: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { field: { type: 'string' }, message: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}
