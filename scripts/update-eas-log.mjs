#!/usr/bin/env node
/**
 * Refreshes ./eas-log.jsonl — a local, git-ignored activity log of EAS builds
 * and git commits, one JSON record per line, newest-first.
 *
 * It MERGES rather than overwrites: existing records are kept and de-duped by
 * build id / commit hash, and a freshly-fetched build replaces its older entry
 * (so an IN_PROGRESS build later becomes FINISHED). Records that have aged out
 * of `eas build:list` are never dropped.
 *
 * Run manually with `npm run log:eas`, or let the post-build npm hooks call it.
 * Logging failures NEVER fail the build — this script always exits 0.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const LOG_FILE = 'eas-log.jsonl';
const BUILD_LIMIT = 20;
const COMMIT_LIMIT = 25;

const tsOf = (o) => Date.parse(o.createdAt || o.date || 0) || 0;
const keyOf = (o) => (o.type === 'build' ? `build:${o.id}` : `commit:${o.hash}`);

function readExisting() {
  if (!existsSync(LOG_FILE)) return [];
  return readFileSync(LOG_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function fetchBuilds() {
  try {
    const raw = execSync(
      `npx eas-cli build:list --limit ${BUILD_LIMIT} --json --non-interactive`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const builds = JSON.parse(raw);
    return builds.map((b) => ({
      type: 'build',
      source: 'eas',
      id: b.id,
      status: b.status,
      platform: b.platform,
      profile: b.buildProfile,
      distribution: b.distribution,
      channel: b.channel ?? null,
      appVersion: b.appVersion,
      appBuildVersion: b.appBuildVersion,
      runtimeVersion: b.runtimeVersion,
      gitCommitHash: b.gitCommitHash,
      gitCommitSubject: (b.gitCommitMessage || '').split('\n')[0],
      createdAt: b.createdAt,
      completedAt: b.completedAt ?? null,
      buildUrl: b.artifacts?.buildUrl ?? null,
    }));
  } catch (e) {
    console.warn(`[update-eas-log] could not fetch builds: ${e.message.split('\n')[0]}`);
    return [];
  }
}

function fetchCommits() {
  try {
    const raw = execSync(`git log -${COMMIT_LIMIT} --pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%cI`, {
      encoding: 'utf8',
    });
    return raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [hash, abbrev, subject, author, date] = l.split('\x1f');
        return { type: 'commit', source: 'git', hash, abbrev, subject, author, date };
      });
  } catch {
    return [];
  }
}

const merged = new Map();
for (const rec of readExisting()) merged.set(keyOf(rec), rec);
// fresh builds win over stale ones (status/url updates); commits are immutable
for (const rec of fetchBuilds()) merged.set(keyOf(rec), rec);
for (const rec of fetchCommits()) if (!merged.has(keyOf(rec))) merged.set(keyOf(rec), rec);

const all = [...merged.values()].sort((a, b) => tsOf(b) - tsOf(a));
writeFileSync(LOG_FILE, all.map((r) => JSON.stringify(r)).join('\n') + '\n');

const builds = all.filter((r) => r.type === 'build').length;
const commits = all.filter((r) => r.type === 'commit').length;
console.log(`[update-eas-log] ${LOG_FILE}: ${builds} builds + ${commits} commits = ${all.length} records`);
