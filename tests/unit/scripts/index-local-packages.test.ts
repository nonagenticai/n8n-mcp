import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createDatabaseAdapter, DatabaseAdapter } from '../../../src/database/database-adapter';
import { NodeRepository } from '../../../src/database/node-repository';
import { indexLocalPackages } from '../../../src/scripts/index-local-packages';

const PKG = '@acme/n8n-nodes-demo';

function nodeSource(className: string, name: string): string {
  return `
class ${className} {
  constructor() {
    this.description = {
      displayName: '${className}',
      name: '${name}',
      group: ['transform'],
      version: 1,
      description: '${className} test node',
      defaults: { name: '${className}' },
      inputs: ['main'],
      outputs: ['main'],
      usableAsTool: true,
      properties: [
        {
          displayName: 'Resource',
          name: 'resource',
          type: 'options',
          options: [{ name: 'Thing', value: 'thing' }],
          default: 'thing'
        }
      ]
    };
  }
}
module.exports = { ${className} };
`;
}

function writePackage(root: string, version: string, nodes: Array<[string, string]>): string {
  const dir = path.join(root, `pkg-${version}`);
  const nodePaths: string[] = [];
  for (const [className, name] of nodes) {
    const rel = `dist/nodes/${className}/${className}.node.js`;
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), nodeSource(className, name));
    nodePaths.push(rel);
  }
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: PKG, version, author: 'Acme', n8n: { nodes: nodePaths } })
  );
  return dir;
}

describe('indexLocalPackages', () => {
  let tmp: string;
  let db: DatabaseAdapter;
  let repository: NodeRepository;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'index-local-'));
    db = await createDatabaseAdapter(path.join(tmp, 'nodes.db'));
    // Without FTS5 objects, so the test runs on the sql.js fallback as well
    const schema = fs
      .readFileSync(path.join(__dirname, '../../../src/database/schema.sql'), 'utf8')
      .replace(/CREATE VIRTUAL TABLE[^;]*nodes_fts[^;]*;/g, '')
      .replace(/CREATE TRIGGER[\s\S]*?\bEND;/g, '');
    db.exec(schema);
    repository = new NodeRepository(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('stores full schemas under the installed node type as unverified community nodes', async () => {
    const dir = writePackage(tmp, '1.0.0', [['Demo', 'demo']]);

    const result = await indexLocalPackages([dir], db);

    expect(result).toEqual({ saved: 2, failed: 0, removed: 0 });
    const node = repository.getNode(`${PKG}.demo`);
    expect(node).toBeTruthy();
    expect(node.package).toBe(PKG);
    expect(node.isCommunity).toBe(true);
    expect(node.isVerified).toBe(false);
    expect(node.npmPackageName).toBe(PKG);
    expect(node.npmVersion).toBe('1.0.0');
    expect(node.properties.map((p: any) => p.name)).toContain('resource');
    expect(node.hasToolVariant).toBe(true);
    expect(repository.getNode(`${PKG}.demoTool`)?.isToolVariant).toBe(true);
  });

  it('removes nodes a newer version of the package no longer ships', async () => {
    await indexLocalPackages([writePackage(tmp, '1.0.0', [['Demo', 'demo']])], db);

    const result = await indexLocalPackages([writePackage(tmp, '2.0.0', [['Other', 'other']])], db);

    expect(result.removed).toBe(2);
    expect(repository.getNode(`${PKG}.demo`)).toBeFalsy();
    expect(repository.getNode(`${PKG}.other`)?.npmVersion).toBe('2.0.0');
  });

  it('skips directories without n8n nodes', async () => {
    const dir = path.join(tmp, 'lib');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@acme/lib', version: '1.0.0' }));

    const result = await indexLocalPackages([dir], db);

    expect(result).toEqual({ saved: 0, failed: 0, removed: 0 });
  });
});
