const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { ensureGitRepo, runGit } = require('../utils/git');
const { getOperationState, getUnmergedPaths } = require('../utils/git-state');

function getConflictPreview(file) {
  // Try combined diff first, fallback to showing markers snippet
  const cc = runGit(['diff', '--cc', '--', file], { allowError: true }) || '';
  if (cc.trim()) return cc.split('\n').slice(0, 30).join('\n');
  try {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    const marked = lines.map((l, i) => ({ l, i })).filter(x => x.l.startsWith('<<<<<<<') || x.l.startsWith('=======') || x.l.startsWith('>>>>>>>'));
    if (!marked.length) return '';
    const first = Math.max(0, marked[0].i - 3);
    const last = Math.min(lines.length, marked[marked.length - 1].i + 4);
    return lines.slice(first, last).join('\n');
  } catch { return ''; }
}

function createCheckpoint() {
  // Stash create gives a dangling commit without touching refs — ideal checkpoint
  const sha = runGit('stash create', { allowError: true });
  if (sha && /^[0-9a-f]{40}$/.test(sha)) {
    runGit(['update-ref', 'refs/smart-git/checkpoint', sha], { allowError: true });
    return sha.slice(0, 7);
  }
  // fallback: stashing via push keeps working tree intact via --keep-index style isn't needed for conflicts — use regular stash push
  // Only if there is something to stash (conflicts already count as dirty)
  try {
    runGit(['stash', 'push', '-m', 'smart-git checkpoint before resolve', '--keep-index'], { allowError: true });
    const list = runGit('stash list', { allowError: true }) || '';
    if (list.includes('smart-git checkpoint')) return 'stash';
  } catch {}
  return null;
}

function resolveWith(file, side) {
  // side: 'ours' | 'theirs'
  const flag = side === 'ours' ? '--ours' : '--theirs';
  const res = spawnSync('git', ['checkout', flag, '--', file], { stdio: 'pipe', encoding: 'utf8' });
  if (res.status !== 0) throw new Error((res.stderr || '').toString().trim() || `git checkout ${flag} failed`);
  const add = spawnSync('git', ['add', '--', file], { stdio: 'pipe', encoding: 'utf8' });
  if (add.status !== 0) throw new Error((add.stderr || '').toString().trim() || 'git add failed');
}

const resolve = new Command('resolve')
  .description('Guided conflict resolution — preview, pick ours/theirs per file with checkpoint safety (improves `git checkout --ours/--theirs`)')
  .argument('[files...]', 'only resolve these files (default: all conflicted)')
  .option('--ours', 'resolve all selected conflicts by taking ours (current branch)')
  .option('--theirs', 'resolve all selected conflicts by taking theirs (incoming)')
  .option('--dry-run', 'preview without changing files')
  .option('--no-checkpoint', 'skip auto checkpoint before resolving')
  .option('--yes', 'skip confirmation for bulk --ours/--theirs')
  .action(async (files, opts) => {
    ensureGitRepo();
    const options = opts && typeof opts.opts === 'function' ? opts.opts() : opts;
    const filterFiles = Array.isArray(files) ? files : [];
    const useOurs = !!options.ours;
    const useTheirs = !!options.theirs;
    if (useOurs && useTheirs) {
      console.error(chalk.red('✖ Use either --ours or --theirs, not both.'));
      process.exit(1);
    }

    let unmerged = getUnmergedPaths();

    if (filterFiles.length) {
      const wanted = new Set(filterFiles);
      // support directory prefix match like "src/" -> any unmerged starting with it
      unmerged = unmerged.filter(f => {
        if (wanted.has(f)) return true;
        return [...wanted].some(w => f.startsWith(w.replace(/\\/g, '/')));
      });
      const unmatched = filterFiles.filter(f => !unmerged.some(u => u === f || u.startsWith(f)));
      if (unmatched.length) {
        console.log(chalk.yellow(`⚠ Not conflicted (ignored): ${unmatched.join(', ')}`));
      }
    }

    const op = getOperationState();

    console.log(chalk.bold.cyan('▸ smart resolve'));
    console.log(chalk.gray('─'.repeat(40)));

    if (!unmerged.length) {
      const all = getUnmergedPaths();
      if (all.length && filterFiles.length) {
        console.log(chalk.yellow(`No matching conflicts for: ${filterFiles.join(', ')}`));
        console.log(chalk.gray(`All conflicted: ${all.join(', ')}`));
      } else {
        console.log(chalk.green('✔ No conflicts — nothing to resolve.'));
        if (op.operation) {
          console.log(chalk.gray(`  Operation: ${op.operation} still in progress — maybe ready for `) + chalk.cyan('sg continue'));
        } else {
          console.log(chalk.gray('  Tip: ') + chalk.cyan('sg doctor') + chalk.gray(' to diagnose repo state'));
        }
      }
      return;
    }

    console.log(`${chalk.bold('Conflicts:')} ${chalk.red(unmerged.length)} file(s)${op.operation ? chalk.gray(` — ${op.operation} in progress`) : ''}`);
    unmerged.forEach(f => console.log(`  ${chalk.red('✖')} ${f}`));

    if (options.dryRun) {
      console.log(chalk.gray('─'.repeat(40)));
      console.log(chalk.yellow('[dry-run] Would resolve:'));
      if (useOurs) unmerged.forEach(f => console.log(chalk.gray(`  • ${f} → ours`)));
      else if (useTheirs) unmerged.forEach(f => console.log(chalk.gray(`  • ${f} → theirs`)));
      else unmerged.forEach(f => console.log(chalk.gray(`  • ${f} → interactive picker (ours/theirs/manual)`)));
      const cp = options.checkpoint !== false ? 'would create checkpoint refs/smart-git/checkpoint' : 'no checkpoint';
      console.log(chalk.gray(`  Checkpoint: ${cp}`));
      console.log(chalk.yellow('[dry-run] No changes made'));
      return;
    }

    // checkpoint
    let checkpoint = null;
    if (options.checkpoint !== false) {
      checkpoint = createCheckpoint();
      if (checkpoint) console.log(chalk.gray(`  → checkpoint: ${checkpoint} at refs/smart-git/checkpoint (restore: git reset --hard refs/smart-git/checkpoint)`));
      else console.log(chalk.gray('  → checkpoint: skipped (nothing to stash or stash failed)'));
    }

    // Bulk modes
    if (useOurs || useTheirs) {
      const side = useOurs ? 'ours' : 'theirs';
      if (!options.yes) {
        const { ok } = await inquirer.prompt([{ type: 'confirm', name: 'ok', message: chalk.yellow(`Resolve ${unmerged.length} file(s) with --${side}?`), default: false }]);
        if (!ok) { console.log(chalk.yellow('Cancelled.')); return; }
      }
      let okCount = 0;
      for (const f of unmerged) {
        try { resolveWith(f, side); console.log(chalk.green(`✔ ${f} → ${side}`)); okCount++; } catch (e) { console.error(chalk.red(`✖ ${f}: ${e.message}`)); }
      }
      console.log(chalk.gray('─'.repeat(40)));
      const remaining = getUnmergedPaths().length;
      if (remaining === 0) {
        console.log(chalk.green.bold(`✔ All ${okCount} file(s) resolved with ${side}.`));
        if (op.operation) console.log(chalk.gray('Next: ') + chalk.cyan('sg continue') + chalk.gray(' to resume ') + chalk.cyan(op.operation));
        else console.log(chalk.gray('Next: ') + chalk.cyan('sg commit') + chalk.gray(' or ') + chalk.cyan('sg continue'));
      } else {
        console.log(chalk.yellow(`${remaining} conflict(s) remain. Re-run `) + chalk.cyan('sg resolve') + chalk.yellow(' for the rest.'));
      }
      if (checkpoint) console.log(chalk.gray(`  Checkpoint at refs/smart-git/checkpoint — undo with: git reset --hard refs/smart-git/checkpoint`));
      return;
    }

    // Interactive per-file picker
    let resolvedCount = 0;
    for (let i = 0; i < unmerged.length; i++) {
      const file = unmerged[i];
      console.log(chalk.gray('─'.repeat(40)));
      console.log(chalk.bold(`[${i + 1}/${unmerged.length}] ${file}`));
      const preview = getConflictPreview(file);
      if (preview) {
        console.log(chalk.gray('Preview (truncated):'));
        console.log(chalk.gray(preview.split('\n').slice(0, 15).join('\n')));
      }
      const { choice } = await inquirer.prompt([{
        type: 'list',
        name: 'choice',
        message: `Resolve ${file}:`,
        choices: [
          { name: 'Keep ours (current branch)', value: 'ours' },
          { name: 'Take theirs (incoming branch)', value: 'theirs' },
          { name: 'Open in editor (manual edit)', value: 'edit' },
          { name: 'Skip this file', value: 'skip' },
          { name: 'Abort resolving (keep remaining)', value: 'abort' },
        ]
      }]);
      if (choice === 'abort') { console.log(chalk.yellow('Aborted — remaining files untouched.')); break; }
      if (choice === 'skip') { console.log(chalk.yellow(`→ skipped ${file}`)); continue; }
      if (choice === 'edit') {
        console.log(chalk.cyan(`→ Open ${file} in your editor, save fixes, then we will stage it.`));
        const { done } = await inquirer.prompt([{ type: 'confirm', name: 'done', message: `Mark ${file} as resolved (git add)?`, default: true }]);
        if (!done) { console.log(chalk.yellow(`→ skipped ${file}`)); continue; }
        // Check file still has markers — warn but still allow add
        try {
          const txt = fs.readFileSync(file, 'utf8');
          if (txt.includes('<<<<<<<')) console.log(chalk.yellow('⚠ File still contains conflict markers — staging anyway'));
        } catch {}
        try { runGit(['add', '--', file]); console.log(chalk.green(`✔ ${file} staged (manual)`)); resolvedCount++; } catch (e) { console.error(chalk.red(`✖ git add failed: ${e.message}`)); }
        continue;
      }
      try { resolveWith(file, choice); console.log(chalk.green(`✔ ${file} → ${choice}`)); resolvedCount++; } catch (e) { console.error(chalk.red(`✖ ${file}: ${e.message}`)); }
    }

    console.log(chalk.gray('─'.repeat(40)));
    const remaining2 = getUnmergedPaths().length;
    if (remaining2 === 0) {
      console.log(chalk.green.bold(`✔ All conflicts resolved (${resolvedCount} file(s) handled).`));
      const op2 = getOperationState();
      if (op2.operation) console.log(chalk.gray('Next: ') + chalk.cyan('sg continue') + chalk.gray(` to resume ${op2.operation}`));
      else console.log(chalk.gray('Next: ') + chalk.cyan('sg commit') + chalk.gray(' to finalize the merge'));
    } else {
      console.log(chalk.yellow(`→ ${resolvedCount} resolved, ${remaining2} remaining: ${getUnmergedPaths().join(', ')}`));
      console.log(chalk.gray('  Re-run ') + chalk.cyan('sg resolve') + chalk.gray(' or ') + chalk.cyan('sg resolve --ours/--theirs') + chalk.gray(' for the rest, or ') + chalk.cyan('sg abort') + chalk.gray(' to give up'));
    }
    if (checkpoint) console.log(chalk.gray(`  Checkpoint: refs/smart-git/checkpoint → git reset --hard refs/smart-git/checkpoint to undo`));
  });

module.exports = resolve;
