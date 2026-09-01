/*
 * WHAT DID THE WORKFLOW'S AGENTS ACTUALLY WRITE?
 *
 * The parity fix-spec workflow told every agent, in capitals, not to edit any file — they were to
 * return specs so the writes could be applied centrally, serially, against shared files that fifteen
 * agents were reading at once. Several edited anyway.
 *
 * That cannot be untangled with `git diff`: the tree was already dirty with a session's worth of
 * legitimate work, so a diff against HEAD mixes mine with theirs and shows build.ts as "1383
 * insertions" without saying whose. The transcripts do know — every agent's .jsonl records each tool
 * call it made — so this reads them and reports precisely which files each agent wrote, and what.
 *
 * Use it before trusting a working tree that a workflow has been running against.
 *
 *   node scripts/workflow-file-edits.mjs <transcript-dir>            # summary per file
 *   node scripts/workflow-file-edits.mjs <transcript-dir> --detail   # every edit, with its payload
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const DETAIL = process.argv.includes('--detail');
if (!dir) { console.error('usage: node scripts/workflow-file-edits.mjs <transcript-dir> [--detail]'); process.exit(2); }

const WRITERS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);
const edits = [];

for (const f of readdirSync(dir)) {
  if (!f.startsWith('agent-') || !f.endsWith('.jsonl')) continue;
  const agent = f.slice(6, -6);
  let lines;
  try { lines = readFileSync(join(dir, f), 'utf8').split('\n'); } catch { continue; }
  for (const line of lines) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    /* Tool calls appear as assistant messages carrying tool_use content blocks. The transcript shape
     * varies between runs, so both the nested and flattened forms are handled. */
    const blocks = j?.message?.content ?? j?.content ?? [];
    for (const b of Array.isArray(blocks) ? blocks : []) {
      if (b?.type !== 'tool_use' || !WRITERS.has(b.name)) continue;
      const p = b.input ?? {};
      edits.push({
        agent,
        tool: b.name,
        file: p.file_path ?? p.path ?? '(unknown)',
        old: typeof p.old_string === 'string' ? p.old_string : undefined,
        neu: typeof p.new_string === 'string' ? p.new_string : typeof p.content === 'string' ? p.content : undefined,
      });
    }
  }
}

if (!edits.length) {
  console.log('No Edit/Write calls found in any agent transcript — the agents wrote nothing.');
  process.exit(0);
}

const byFile = {};
for (const e of edits) (byFile[e.file] ??= []).push(e);

console.log(`${edits.length} write(s) by ${new Set(edits.map((e) => e.agent)).size} agent(s), across ${Object.keys(byFile).length} file(s):\n`);
for (const [file, list] of Object.entries(byFile).sort((a, b) => b[1].length - a[1].length)) {
  const agents = new Set(list.map((e) => e.agent));
  const flag = agents.size > 1 ? '  ⚠ MULTIPLE AGENTS' : '';
  console.log(`   ${String(list.length).padStart(3)}  ${file}   (${agents.size} agent)${flag}`);
}

if (DETAIL) {
  for (const [file, list] of Object.entries(byFile)) {
    console.log(`\n══ ${file}`);
    for (const e of list) {
      console.log(`\n-- ${e.tool} by ${e.agent}`);
      if (e.old !== undefined) console.log(`   OLD: ${JSON.stringify(e.old.slice(0, 300))}`);
      if (e.neu !== undefined) console.log(`   NEW: ${JSON.stringify(e.neu.slice(0, 300))}`);
    }
  }
}
