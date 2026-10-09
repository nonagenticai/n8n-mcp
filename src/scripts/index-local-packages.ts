#!/usr/bin/env node
/**
 * Index n8n node packages that are installed on disk but not published on the
 * public npm registry (e.g. packages from a private registry).
 *
 * Unlike `fetch:community`, which stores metadata only, this loads each
 * package's node classes and stores the full schema (properties, operations,
 * credentials, versions), the same way `rebuild` does for core nodes.
 *
 * Rows are stored as unverified community nodes keyed `<package name>.<node name>`,
 * the node type n8n itself uses for installed packages. `rebuild` preserves
 * community rows, so they survive a core rebuild.
 *
 * Usage:
 *   node dist/scripts/index-local-packages.js <package-dir> [<package-dir> ...]
 *
 * Each <package-dir> is a directory containing a package.json with an
 * `n8n.nodes` list. Directories without one are skipped.
 *
 * Environment variables:
 *   NODE_DB_PATH  - Database path (default: ./data/nodes.db)
 */
import * as fs from 'fs';
import * as path from 'path';
import { createDatabaseAdapter, DatabaseAdapter } from '../database/database-adapter';
import { N8nNodeLoader, LoadedNode } from '../loaders/node-loader';
import { NodeParser, ParsedNode } from '../parsers/node-parser';
import { NodeRepository } from '../database/node-repository';
import { ToolVariantGenerator } from '../services/tool-variant-generator';

interface PackageInfo {
  dir: string;
  name: string;
  version: string;
  author?: string;
  json: any;
}

function readPackage(dir: string): PackageInfo | null {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.warn(`⚠ Skipping ${dir}: no package.json`);
    return null;
  }
  const json = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const nodes = json.n8n?.nodes;
  const count = Array.isArray(nodes) ? nodes.length : Object.keys(nodes || {}).length;
  if (count === 0) {
    console.log(`- Skipping ${json.name}: no n8n.nodes`);
    return null;
  }
  const author = typeof json.author === 'string' ? json.author : json.author?.name;
  return { dir, name: json.name, version: json.version, author, json };
}

/** n8n keys installed-package nodes as `<package name>.<description name>`. */
function installedNodeType(packageName: string, parsedNodeType: string): string {
  const shortName = parsedNodeType.slice(parsedNodeType.lastIndexOf('.') + 1);
  return `${packageName}.${shortName}`;
}

export interface IndexResult {
  saved: number;
  failed: number;
  removed: number;
}

export async function indexLocalPackages(dirs: string[], db: DatabaseAdapter): Promise<IndexResult> {
  const repository = new NodeRepository(db);
  const loader = new N8nNodeLoader();
  const parser = new NodeParser();
  const toolVariantGenerator = new ToolVariantGenerator();

  let saved = 0;
  let failed = 0;
  let removed = 0;

  for (const dir of dirs) {
    const pkg = readPackage(dir);
    if (!pkg) continue;

    console.log(`\n📦 ${pkg.name}@${pkg.version}`);
    // loadPackageNodes is private in TypeScript only; reusing it keeps the
    // loading behaviour (export resolution, stubbed optional deps) identical to rebuild.
    const loaded: LoadedNode[] = await (loader as any).loadPackageNodes(pkg.name, pkg.dir, pkg.json);

    const community = {
      isCommunity: true,
      isVerified: false,
      authorName: pkg.author,
      npmPackageName: pkg.name,
      npmVersion: pkg.version,
      npmDownloads: 0,
      communityFetchedAt: new Date().toISOString()
    };

    const keep: string[] = [];
    for (const { nodeName, NodeClass } of loaded) {
      try {
        const parsed: ParsedNode = parser.parse(NodeClass, pkg.name);
        parsed.nodeType = installedNodeType(pkg.name, parsed.nodeType);
        const versions = parser.parseVersions(NodeClass, pkg.name).map(v => ({
          ...v,
          nodeType: parsed.nodeType
        }));

        const rows: ParsedNode[] = [];
        if (parsed.isAITool && !parsed.isTrigger) {
          const toolVariant = toolVariantGenerator.generateToolVariant(parsed);
          if (toolVariant) {
            parsed.hasToolVariant = true;
            rows.push(toolVariant);
          }
        }
        rows.unshift(parsed);

        db.transaction(() => {
          for (const row of rows) {
            repository.saveNode({ ...row, ...community });
          }
          for (const version of versions) {
            repository.saveNodeVersion({
              nodeType: version.nodeType,
              version: version.version,
              packageName: version.packageName,
              displayName: version.displayName,
              description: version.description,
              category: version.category,
              isCurrentMax: version.isCurrentMax,
              propertiesSchema: version.properties,
              operations: version.operations,
              credentialsRequired: version.credentials,
              outputs: version.outputs,
              addedProperties: version.addedProperties,
              deprecatedProperties: version.deprecatedProperties
            });
          }
        });

        for (const row of rows) {
          keep.push(row.nodeType);
          saved++;
          console.log(`  ✅ ${row.nodeType} [Props: ${row.properties.length}, Ops: ${row.operations.length}]`);
        }
      } catch (error) {
        failed++;
        console.error(`  ❌ ${nodeName}: ${(error as Error).message}`);
      }
    }

    // Drop rows for nodes this package no longer ships
    removed += repository.deleteStaleCommunityNodes(pkg.name, keep);
  }

  // sql.js builds have no FTS5, so the index may be absent
  const hasFts = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'nodes_fts'"
  ).get();
  if (hasFts) {
    db.prepare("INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild')").run();
  }
  return { saved, failed, removed };
}

async function main(): Promise<void> {
  const dirs = process.argv.slice(2).map(d => path.resolve(d));
  if (dirs.length === 0) {
    console.error('Usage: index-local-packages <package-dir> [<package-dir> ...]');
    process.exit(2);
  }

  const dbPath = process.env.NODE_DB_PATH || './data/nodes.db';
  const db = await createDatabaseAdapter(dbPath);
  const { saved, failed, removed } = await indexLocalPackages(dirs, db);
  db.close();

  console.log(`\nSaved ${saved} node rows, removed ${removed} stale, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

if (require.main === module) main().catch(error => {
  console.error(error);
  process.exit(1);
});
