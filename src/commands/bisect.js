const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { spawnSync } = require('child_process');
const { ensureGitRepo, runGit } = require('../utils/git');
const { getOperationState } = require('../utils/git-state');
const { UserError } = require('../utils/errors');

function isBisectActive() {
  return getOperationState().operation === 'bisect';
}

function getCommits(limit = 50) {
  const out = runGit(`log --oneline --all -n ${limit}`, { allowError: true }) || '';
  return out.split('\n').filter(Boolean).map(line => {
    const sp = line.indexOf(' ');
    const hash = sp >= 0 ? line.slice(0, sp) : line;
    const msg = sp >= 0 ? line.slice(sp + 1) : '';
    return { hash, msg, raw: line };
  });
}

async function pickCommit(message, _def = '') {
  const commits = getCommits(80);
  if (!commits.length) throw new UserError('No commits to pick from');
  const choices = commits.map(c => ({ name: `${c.hash} ${c.msg}`, value: c.hash }));
  choices.unshift({ name: `HEAD (${runGit('rev-parse --short HEAD', { allowError: true })})`, value: 'HEAD' });
  const { picked } = await inquirer.prompt([{ type: 'list', name: 'picked', message, choices, pageSize: 12 }]);
  return picked;
}

function runBisect(args, opts = {}) {
  // run git bisect via array argv (no shell)
  const argv = Array.isArray(args) ? args : args.split(' ').filter(Boolean);
  const result = spawnSync('git', ['bisect', ...argv], { stdio: opts.inherit ? 'inherit' : 'pipe', encoding: 'utf8' });
  const out = (result.stdout || '') + (result.stderr || '');
  if (result.status !== 0 && !opts.allowError) {
    const msg = out.trim() || `git bisect ${argv.join(' ')} failed`;
    throw new UserError(msg);
  }
  return out.trim();
}

const bisect = new Command('bisect')
  .description('Binary search — find the commit that broke things (improves `git bisect`)')
  .argument('[action]', 'start|good|bad|skip|reset|run|log|status|visual  (default: status picker if active, else help)')
  .argument('[target...]', 'commit/ref or command for run')
  .option('--bad <ref>', 'bad commit (with start)')
  .option('--good <ref>', 'good commit(s) (with start, repeatable)')
  .option('--test <cmd>', 'auto-run command (with start: git bisect run <cmd>)')
  .action(async (action, target, opts, cmd) => {
    ensureGitRepo();
    const targetStr = (target || []).join(' ').trim();
    const _rawArgs = cmd ? cmd.args : [];
    // normalize action aliases
    const act = (action || '').toLowerCase();

    // --log / log action
    if (act === 'log' || opts.log) {
      const out = runBisect(['log'], { allowError: true });
      console.log(out || chalk.gray('(no bisect log)'));
      return;
    }
    if (act === 'visual' || act === 'view') {
      const out = runGit('log --oneline --graph --all --decorate -n 30', { allowError: true }) || '';
      console.log(chalk.bold.cyan('▸ bisect visual'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log(out || chalk.gray('(no history)'));
      if (isBisectActive()) {
        const log = runBisect(['log'], { allowError: true });
        console.log(chalk.gray('─'.repeat(40)));
        console.log(chalk.gray(log.split('\n').slice(0, 20).join('\n')));
      }
      return;
    }
    if (act === 'status' || (!act && isBisectActive())) {
      const active = isBisectActive();
      console.log(chalk.bold.cyan('▸ bisect status'));
      console.log(chalk.gray('─'.repeat(40)));
      if (!active) {
        console.log(chalk.gray('No bisect in progress.'));
        console.log(chalk.gray(`Start: ${chalk.cyan('sg bisect start')}  or  ${chalk.cyan('sg bisect start --bad HEAD --good <old>')}`));
        console.log(chalk.gray(`       ${chalk.cyan('sg bisect start --test \"npm test\"')}`));
        return;
      }
      const log = runBisect(['log'], { allowError: true });
      const head = runGit('rev-parse --short HEAD', { allowError: true }) || '?';
      const msg = runGit('log -1 --oneline', { allowError: true }) || '';
      console.log(chalk.yellow(`Bisecting: ${head} — ${msg}`));
      if (log) console.log(chalk.gray(log.split('\n').slice(-20).join('\n')));
      console.log(chalk.gray('─'.repeat(40)));
      const { next } = await inquirer.prompt([{ type: 'list', name: 'next', message: 'Mark current commit as:', choices: [
        { name: 'good — this commit works', value: 'good' },
        { name: 'bad — this commit is broken', value: 'bad' },
        { name: 'skip — cannot test', value: 'skip' },
        { name: 'run — auto-run a command', value: 'run' },
        { name: 'reset — abort bisect', value: 'reset' },
        { name: 'log — show history', value: 'log' },
        { name: 'cancel', value: 'cancel' },
      ]}]);
      if (next === 'cancel') return;
      if (next === 'log') { console.log(runBisect(['log'], { allowError: true })); return; }
      if (next === 'run') {
        const { cmdStr } = await inquirer.prompt([{ type: 'input', name: 'cmdStr', message: 'Command to run (exit 0=good, 1=bad):', default: 'npm test' }]);
        console.log(chalk.gray(`→ git bisect run ${cmdStr}`));
        runBisect(['run', ...cmdStr.split(' ').filter(Boolean)], { inherit: true, allowError: true });
        const after = isBisectActive();
        if (!after) console.log(chalk.green.bold('✔ Bisect finished — see result above'));
        else console.log(chalk.yellow('Bisect still in progress — run sg bisect again'));
        return;
      }
      if (next === 'reset') {
        runBisect(['reset']);
        console.log(chalk.green('✔ Bisect reset'));
        return;
      }
      const out = runBisect([next], { allowError: true });
      console.log(out);
      if (!isBisectActive()) console.log(chalk.green.bold('✔ Bisect finished — first bad commit identified above'));
      else console.log(chalk.gray(`→ next: sg bisect (pick good/bad/skip)`));
      return;
    }

    // reset
    if (act === 'reset' || opts.reset) {
      if (!isBisectActive()) { console.log(chalk.gray('No bisect to reset.')); return; }
      runBisect(['reset']);
      console.log(chalk.green('✔ Bisect reset — back to original branch'));
      return;
    }
    // good / bad / skip with optional ref
    if (['good', 'bad', 'skip'].includes(act)) {
      if (!isBisectActive() && act !== 'bad' && act !== 'good') {
        throw new UserError(`No bisect in progress — start with sg bisect start`);
      }
      const ref = targetStr || undefined;
      const args = ref ? [act, ref] : [act];
      const out = runBisect(args, { allowError: true });
      console.log(out);
      if (out.toLowerCase().includes('first bad commit') || out.toLowerCase().includes('is the first bad commit')) {
        console.log(chalk.green.bold('✔ Found first bad commit'));
      } else if (!isBisectActive()) {
        console.log(chalk.green('✔ Bisect finished'));
      } else {
        console.log(chalk.gray(`→ now bisecting — run ${chalk.cyan('sg bisect')} to mark next`));
      }
      return;
    }
    // run
    if (act === 'run') {
      if (!isBisectActive()) throw new UserError('No bisect in progress — run sg bisect start first');
      const cmdStr = targetStr || opts.test;
      if (!cmdStr) throw new UserError('sg bisect run <command>  e.g. sg bisect run \"npm test\"');
      console.log(chalk.gray(`→ git bisect run ${cmdStr}`));
      runBisect(['run', ...cmdStr.split(' ').filter(Boolean)], { inherit: true, allowError: true });
      if (!isBisectActive()) console.log(chalk.green.bold('✔ Bisect finished'));
      return;
    }
    // start
    if (act === 'start' || (!act && targetStr === '' && (opts.bad || opts.good || opts.test))) {
      if (isBisectActive()) {
        console.log(chalk.yellow('Bisect already in progress — reset first with ') + chalk.cyan('sg bisect reset'));
        const { doReset } = await inquirer.prompt([{ type: 'confirm', name: 'doReset', message: 'Reset current bisect and start new?', default: false }]);
        if (!doReset) return;
        runBisect(['reset']);
      }
      let bad = opts.bad || null;
      let goods = [];
      if (opts.good) goods = Array.isArray(opts.good) ? opts.good : [opts.good];
      // also allow positional goods after start
      if (targetStr && !bad && !goods.length) {
        // heuristic: if targetStr looks like refs, treat first as bad
      }
      if (!bad) {
        console.log(chalk.bold.cyan('▸ bisect start — pick bad commit (usually HEAD)'));
        bad = await pickCommit('Bad commit (broken):', 'HEAD');
      }
      if (!goods.length) {
        console.log(chalk.bold.cyan('▸ pick good commit (known working)'));
        const goodOne = await pickCommit('Good commit:');
        goods = [goodOne];
      }
      console.log(chalk.gray(`→ git bisect start`));
      runBisect(['start']);
      console.log(chalk.gray(`→ git bisect bad ${bad}`));
      let out = runBisect(['bad', bad], { allowError: true });
      console.log(out);
      for (const g of goods) {
        console.log(chalk.gray(`→ git bisect good ${g}`));
        out = runBisect(['good', g], { allowError: true });
        console.log(out);
      }
      if (opts.test) {
        console.log(chalk.gray(`→ git bisect run ${opts.test}`));
        runBisect(['run', ...String(opts.test).split(' ').filter(Boolean)], { inherit: true, allowError: true });
      }
      if (!isBisectActive()) {
        console.log(chalk.green.bold('✔ Bisect finished immediately — check output above'));
      } else {
        const head = runGit('log -1 --oneline', { allowError: true }) || '';
        console.log(chalk.yellow(`Bisecting at ${head}`));
        console.log(chalk.gray(`Mark with ${chalk.cyan('sg bisect good/bad/skip')} or ${chalk.cyan('sg bisect')} for picker`));
      }
      return;
    }

    // fallback: help
    console.log(chalk.bold.cyan('▸ sg bisect'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  ${chalk.cyan('sg bisect start')}                 start wizard (picks bad/good)`);
    console.log(`  ${chalk.cyan('sg bisect start --bad <ref> --good <ref> [--test \"cmd\"]')}`);
    console.log(`  ${chalk.cyan('sg bisect')}                       status picker (when active)`);
    console.log(`  ${chalk.cyan('sg bisect good|bad|skip [ref]')}   mark current/next`);
    console.log(`  ${chalk.cyan('sg bisect run \"npm test\"')}       auto-run command`);
    console.log(`  ${chalk.cyan('sg bisect log')}                   show bisect log`);
    console.log(`  ${chalk.cyan('sg bisect reset')}                 abort & return`);
    console.log(`  ${chalk.cyan('sg bisect visual')}                graph + log`);
    console.log(chalk.gray('─'.repeat(40)));
    if (isBisectActive()) {
      console.log(chalk.yellow('Bisect in progress — run ') + chalk.cyan('sg bisect') + chalk.yellow(' to mark next'));
    }
  });

module.exports = bisect;
