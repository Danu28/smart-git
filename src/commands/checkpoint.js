const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const _gitMod = require('../utils/git');
const { UserError } = require('../utils/errors');
const { ensureGitRepo, runGit, getChangedFiles } = _gitMod;

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'checkpoint';
}

function getCheckpoints() {
  const list = runGit('stash list', { allowError: true }) || '';
  if (!list.trim()) return [];
  const lines = list.split('\n').filter(Boolean);
  const cps = [];
  for (const line of lines) {
    if (!line.includes('checkpoint:')) continue;
    const m = line.match(/stash@\{(\d+)\}/);
    const idx = m ? parseInt(m[1], 10) : null;
    // message after "checkpoint: "
    const msgIdx = line.indexOf('checkpoint:');
    const msg = msgIdx >= 0 ? line.slice(msgIdx + 'checkpoint:'.length).trim() : line;
    cps.push({ index: idx, ref: idx !== null ? `stash@{${idx}}` : null, raw: line, message: msg });
  }
  return cps;
}

function resolveRef(input) {
  if (!input) return null;
  const s = String(input).trim();
  // stash@{n} direct
  if (/^stash@\{\d+\}$/.test(s)) return s;
  // numeric index
  if (/^\d+$/.test(s)) return `stash@{${s}}`;
  // message substring search
  const cps = getCheckpoints();
  const lower = s.toLowerCase();
  const found = cps.find(c => c.message.toLowerCase().includes(lower) || c.raw.toLowerCase().includes(lower));
  if (found) return found.ref;
  // fallback: try as-is (maybe checkpoint name)
  return s;
}

const checkpoint = new Command('checkpoint')
  .description('Savepoints — named stash checkpoints you can actually find (improves `git stash`)')
  .alias('chk')
  .alias('save')
  .argument('[message]', 'message for new checkpoint (creates one if given)')
  .option('-l, --list', 'list checkpoints')
  .option('-u, --include-untracked', 'include untracked files (git stash -u)')
  .option('--keep-index', 'keep staged changes in index (git stash --keep-index)')
  .option('--restore <ref>', 'restore checkpoint (apply & keep, e.g. 0 or stash@{0} or message substring)')
  .option('--apply <ref>', 'alias for --restore')
  .option('--pop <ref>', 'pop checkpoint (apply & drop)')
  .option('--drop <ref>', 'drop checkpoint')
  .option('--clear', 'clear all checkpoints (confirm)')
  .option('--diff <ref>', 'show checkpoint diff (git stash show -p)')
  .option('--show <ref>', 'alias for --diff')
  .action(async (message, opts) => {
    ensureGitRepo();

    // --list
    if (opts.list) {
      const cps = getCheckpoints();
      console.log(chalk.bold.cyan('▸ checkpoints'));
      console.log(chalk.gray('─'.repeat(40)));
      if (!cps.length) {
        console.log(chalk.gray('No checkpoints — create with `sg checkpoint \"my try\"` or `sg chk -u \"msg\"`'));
      } else {
        cps.forEach(c => console.log(chalk.gray(c.raw)));
        console.log(chalk.gray('─'.repeat(40)));
        console.log(chalk.gray(`Use ${chalk.cyan('sg checkpoint --restore <n>')} or run ${chalk.cyan('sg checkpoint')} for picker`));
      }
      return;
    }

    // --clear
    if (opts.clear) {
      const cps = getCheckpoints();
      if (!cps.length) {
        console.log(chalk.gray('No checkpoints to clear.'));
        return;
      }
      console.log(chalk.yellow(`Found ${cps.length} checkpoint(s):`));
      cps.forEach(c => console.log(chalk.gray('  ' + c.raw)));
      const { ok } = await inquirer.prompt([{ type: 'confirm', name: 'ok', message: chalk.red(`Clear all ${cps.length} checkpoint(s)?`), default: false }]);
      if (!ok) { console.log(chalk.yellow('Cancelled.')); return; }
      // drop from highest index down to avoid shifting
      const sorted = [...cps].sort((a,b)=>b.index - a.index);
      for (const c of sorted) {
        try { runGit(['stash', 'drop', c.ref]); } catch {}
      }
      console.log(chalk.green(`✔ Cleared ${cps.length} checkpoint(s)`));
      return;
    }

    // --diff / --show
    const diffRef = opts.diff || opts.show;
    if (diffRef) {
      const ref = resolveRef(diffRef);
      const out = runGit(['stash', 'show', '-p', ref], { allowError: true });
      if (out === null) throw new UserError(`No checkpoint ${diffRef}`);
      console.log(out);
      return;
    }

    // --drop
    if (opts.drop) {
      const ref = resolveRef(opts.drop);
      const cpsBefore = getCheckpoints().map(c=>c.ref);
      if (!cpsBefore.includes(ref) && !/stash@\{\d+\}/.test(ref)) {
        // allow direct drop even if not filtered as checkpoint
      }
      try {
        runGit(['stash', 'drop', ref]);
        console.log(chalk.green(`✔ Dropped ${ref}`));
      } catch (e) {
        throw new UserError(e.message || `No checkpoint ${opts.drop}`);
      }
      return;
    }

    // --restore / --apply / --pop
    const restoreRef = opts.restore || opts.apply || opts.pop;
    if (restoreRef) {
      const isPop = !!opts.pop;
      const ref = resolveRef(restoreRef);
      try {
        if (isPop) {
          runGit(['stash', 'pop', ref]);
          console.log(chalk.green(`✔ Popped ${ref} (applied & dropped)`));
        } else {
          runGit(['stash', 'apply', ref]);
          console.log(chalk.green(`✔ Restored ${ref} (kept — use --pop to drop)`));
        }
      } catch (e) {
        const msg = e.message || String(e);
        if (msg.includes('conflict') || msg.includes('CONFLICT')) {
          console.error(chalk.yellow('⚠ Restore hit conflicts — resolve them, then `sg checkpoint --drop <ref>` when done.'));
        }
        throw new UserError(msg);
      }
      return;
    }

    // save if message given
    if (message && typeof message === 'string' && message.trim()) {
      const changed = getChangedFiles();
      if (!changed.length) {
        console.log(chalk.yellow('No local changes to checkpoint — working tree clean.'));
        return;
      }
      const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const msg = `checkpoint: ${message.trim()} @${ts} [${slugify(message)}]`;
      const args = ['stash', 'push', '-m', msg];
      if (opts.includeUntracked) args.push('--include-untracked');
      if (opts.keepIndex) args.push('--keep-index');
      runGit(args);
      console.log(chalk.green(`✔ Checkpoint saved: ${chalk.bold(message.trim())}`));
      console.log(chalk.gray(`  → ${msg}`));
      const cps = getCheckpoints();
      if (cps.length) console.log(chalk.gray(`  ${cps.length} checkpoint(s) — ${chalk.cyan('sg checkpoint')} to browse, ${chalk.cyan('sg checkpoint --list')} to list`));
      return;
    }

    // no args → interactive picker (list + actions)
    const cps = getCheckpoints();
    if (!cps.length) {
      console.log(chalk.bold.cyan('▸ checkpoints'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log(chalk.gray('No checkpoints yet.'));
      console.log(chalk.gray(`Create one: ${chalk.cyan('sg checkpoint \"try risky refactor\"')}`));
      console.log(chalk.gray(`With untracked: ${chalk.cyan('sg checkpoint -u \"msg\"')}`));
      const { create } = await inquirer.prompt([{ type: 'confirm', name: 'create', message: 'Create a checkpoint now from current changes?', default: false }]);
      if (create) {
        const { msg } = await inquirer.prompt([{ type: 'input', name: 'msg', message: 'Checkpoint message:', default: 'checkpoint' }]);
        const changed = getChangedFiles();
        if (!changed.length) { console.log(chalk.yellow('No changes to save.')); return; }
        const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
        const stashMsg = `checkpoint: ${msg} @${ts} [${slugify(msg)}]`;
        const args = ['stash', 'push', '-m', stashMsg];
        if (opts.includeUntracked) args.push('--include-untracked');
        runGit(args);
        console.log(chalk.green(`✔ Checkpoint saved: ${msg}`));
      }
      return;
    }

    // picker: show list, let user choose one + action
    console.log(chalk.bold.cyan(`▸ checkpoints — ${cps.length} saved`));
    cps.forEach(c => console.log(chalk.gray('  ' + c.raw)));
    console.log(chalk.gray('─'.repeat(40)));

    const choices = cps.map(c => ({ name: `${c.ref}: ${c.message}`, value: c.ref }));
    choices.push({ name: '— save new checkpoint —', value: '__save__' });
    choices.push({ name: '— cancel —', value: null });
    const { picked } = await inquirer.prompt([{ type: 'list', name: 'picked', message: 'Pick a checkpoint:', choices, pageSize: 10 }]);
    if (!picked) return;
    if (picked === '__save__') {
      const { msg } = await inquirer.prompt([{ type: 'input', name: 'msg', message: 'Checkpoint message:', default: 'checkpoint' }]);
      const changed = getChangedFiles();
      if (!changed.length) { console.log(chalk.yellow('No changes to save.')); return; }
      const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const stashMsg = `checkpoint: ${msg} @${ts} [${slugify(msg)}]`;
      const args = ['stash', 'push', '-m', stashMsg];
      if (opts.includeUntracked) args.push('--include-untracked');
      runGit(args);
      console.log(chalk.green(`✔ Checkpoint saved: ${msg}`));
      return;
    }
    const { action } = await inquirer.prompt([{ type: 'list', name: 'action', message: `Action for ${picked}:`, choices: [
      { name: 'restore (apply & keep)', value: 'apply' },
      { name: 'pop (apply & drop)', value: 'pop' },
      { name: 'diff (show patch)', value: 'diff' },
      { name: 'drop', value: 'drop' },
      { name: 'cancel', value: 'cancel' },
    ]}]);
    if (action === 'cancel') return;
    if (action === 'diff') {
      console.log(runGit(['stash', 'show', '-p', picked], { allowError: true }) || chalk.gray('(no diff)'));
      return;
    }
    if (action === 'apply') {
      try { runGit(['stash', 'apply', picked]); console.log(chalk.green(`✔ Restored ${picked}`)); } catch(e){ throw new UserError(e.message); }
      return;
    }
    if (action === 'pop') {
      try { runGit(['stash', 'pop', picked]); console.log(chalk.green(`✔ Popped ${picked}`)); } catch(e){ throw new UserError(e.message); }
      return;
    }
    if (action === 'drop') {
      const { ok } = await inquirer.prompt([{ type: 'confirm', name: 'ok', message: chalk.red(`Drop ${picked}?`), default: false }]);
      if (!ok) return;
      runGit(['stash', 'drop', picked]);
      console.log(chalk.green(`✔ Dropped ${picked}`));
    }
  });

module.exports = checkpoint;
