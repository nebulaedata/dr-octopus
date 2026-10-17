/**
 * @author Codex
 * @description Provides fixed upstream discovery through real child-process stdio without operating the desktop.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const server = new Server({ name: 'windows-mcp', version: '4.0.5' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'ControlStatus', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    {
      name: 'App',
      inputSchema: {
        type: 'object',
        properties: {
          mode: {
            default: 'launch',
            enum: ['launch', 'launch_executable', 'resize', 'switch'],
            type: 'string',
          },
          name: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
          window_loc: {
            anyOf: [{ items: { type: 'integer' }, type: 'array' }, { type: 'null' }],
            default: null,
          },
          window_size: {
            anyOf: [{ items: { type: 'integer' }, type: 'array' }, { type: 'null' }],
            default: null,
          },
          executable: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
          args: {
            anyOf: [{ items: { type: 'string' }, type: 'array' }, { type: 'string' }, { type: 'null' }],
            default: null,
          },
          cwd: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'DisplayInventory',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'Snapshot',
      inputSchema: {
        type: 'object',
        properties: {
          use_vision: { anyOf: [{ type: 'boolean' }, { type: 'string' }], default: false },
          use_dom: { anyOf: [{ type: 'boolean' }, { type: 'string' }], default: false },
          use_annotation: { anyOf: [{ type: 'boolean' }, { type: 'string' }], default: true },
          use_ui_tree: { anyOf: [{ type: 'boolean' }, { type: 'string' }], default: true },
          width_reference_line: { anyOf: [{ type: 'integer' }, { type: 'null' }], default: null },
          height_reference_line: { anyOf: [{ type: 'integer' }, { type: 'null' }], default: null },
          display: {
            anyOf: [{ items: { type: 'integer' }, type: 'array' }, { type: 'null' }],
            default: null,
          },
          region: {
            anyOf: [{ items: { type: 'integer' }, type: 'array' }, { type: 'string' }, { type: 'null' }],
            default: null,
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'Screenshot',
      inputSchema: {
        type: 'object',
        properties: {
          use_annotation: { anyOf: [{ type: 'boolean' }, { type: 'string' }], default: false },
          width_reference_line: { anyOf: [{ type: 'integer' }, { type: 'null' }], default: null },
          height_reference_line: { anyOf: [{ type: 'integer' }, { type: 'null' }], default: null },
          display: {
            anyOf: [{ items: { type: 'integer' }, type: 'array' }, { type: 'null' }],
            default: null,
          },
          region: {
            anyOf: [{ items: { type: 'integer' }, type: 'array' }, { type: 'string' }, { type: 'null' }],
            default: null,
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'Click',
      inputSchema: {
        type: 'object',
        properties: {
          loc: {
            anyOf: [{ items: { type: 'integer' }, type: 'array' }, { type: 'string' }, { type: 'null' }],
            default: null,
          },
          label: { anyOf: [{ type: 'integer' }, { type: 'null' }], default: null },
          button: { default: 'left', enum: ['left', 'right', 'middle'], type: 'string' },
          clicks: { default: 1, type: 'integer' },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'Type',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          loc: {
            anyOf: [{ items: { type: 'integer' }, type: 'array' }, { type: 'string' }, { type: 'null' }],
            default: null,
          },
          label: { anyOf: [{ type: 'integer' }, { type: 'null' }], default: null },
          clear: { anyOf: [{ type: 'boolean' }, { type: 'string' }], default: false },
          caret_position: { default: 'idle', enum: ['start', 'idle', 'end'], type: 'string' },
          press_enter: { anyOf: [{ type: 'boolean' }, { type: 'string' }], default: false },
        },
        required: ['text'],
        additionalProperties: false,
      },
    },
    {
      name: 'Scroll',
      inputSchema: {
        type: 'object',
        properties: {
          loc: {
            anyOf: [{ items: { type: 'integer' }, type: 'array' }, { type: 'string' }, { type: 'null' }],
            default: null,
          },
          label: { anyOf: [{ type: 'integer' }, { type: 'null' }], default: null },
          type: { default: 'vertical', enum: ['horizontal', 'vertical'], type: 'string' },
          direction: { default: 'down', enum: ['up', 'down', 'left', 'right'], type: 'string' },
          wheel_times: { default: 1, type: 'integer' },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'Shortcut',
      inputSchema: {
        type: 'object',
        properties: { shortcut: { type: 'string' } },
        required: ['shortcut'],
        additionalProperties: false,
      },
    },
  ],
}));
await server.connect(new StdioServerTransport());
