const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { ensureGitRepo, runGit, getCurrentBranch } = require('../utils/git');
const { BRANCH_PREFIXES } = require('../utils/config');

function inferPrefix(name, config) {
  const lower = (name||'').toLowerCase();
  if (/(fix|bug|hotfix)/.test(lower)) return 'fix/';
  if (/(feat|feature)/.test(lower)) return 'feat/';
  if (/docs?/.test(lower) && lower.includes('docs')) return 'docs/';
  if (/perf/.test(lower)) return 'perf/';
  if (/chore/.test(lower)) return 'chore/';
  // ticket regex from config (e.g. PROJ-\\d+)
  try {
    const rx = config && config.ticketRegex ? new RegExp(config.ticketRegex) : null;
    if (rx && rx.test(name)) return 'feat/';
  } catch {}
  return null;
}
const branch = new Command('branch')
  .description('Smart branch — create with convention, switch, clean (improves `git branch`/`checkout`/`switch`)')
  .alias('br')
  .option('-c, --create <name>', 'create branch (auto-prefix help)')
  .option('-d, --delete <name>', 'delete branch (safe, checks merged)')
  .option('-D, --force-delete <name>', 'force delete branch')
  .option('-a, --all', 'list all (including remote)')
  .option('--prune', 'prune merged branches (alias for sg tidy --merged)')
  .option('--fuzzy', 'interactive fuzzy picker for branches')
  .action(async (opts) => {
    ensureGitRepo();

    if (opts.prune) {
      const tidy = require('./tidy');
      console.log(chalk.yellow('→ sg branch --prune → sg tidy --merged'));
      const current = getCurrentBranch();
      const mergedRaw = runGit('branch --merged', { allowError: true }) || '';
      const candidates = mergedRaw.split('\n').map(b=>b.replace('*','').trim()).filter(b=>b && b!==current && !['main','master','develop','dev'].includes(b));
      if (!candidates.length) { console.log(chalk.green('✔ No merged branches to prune.')); return; }
      console.log(chalk.bold(`Merged branches (${candidates.length}):`)); candidates.forEach(b=>console.log(chalk.gray('  • ')+b));
      const { ok } = await inquirer.prompt([{ type:'confirm', name:'ok', message:`Delete ${candidates.length} merged branch(es)?`, default:false }]);
      if (!ok) { console.log(chalk.yellow('Skipped.')); return; }
      for(const b of candidates){ try{ runGit(['branch','-d',b]); console.log(chalk.green(`  deleted ${b}`)); }catch(e){ console.log(chalk.yellow(`  skip ${b}: ${e.message.slice(0,60)}`)); } }
      runGit('fetch --prune', {allowError:true}); console.log(chalk.green.bold('✔ Prune complete')); return;
    }
    if (opts.create) {
      let name = opts.create;
      // Infer prefix (D4) — avoid prompting when inferrable
      if (!BRANCH_PREFIXES.some(p => name.startsWith(p))) {
        let cfg = {}; try { cfg = require('../utils/config').loadAllConfig(); } catch {}
        const inferred = inferPrefix(name, cfg);
        if (inferred) { name = inferred + name; console.log(chalk.gray(`→ inferred prefix: ${inferred}`)); }
        else {
          const { prefix } = await inquirer.prompt([{ type: 'list', name: 'prefix', message: `Choose prefix for "${name}":`, choices: [...BRANCH_PREFIXES, 'no prefix'] }]);
          if (prefix !== 'no prefix') name = prefix + name;
        }
      }
      try {
        runGit(['checkout', '-b', name]);
      } catch (e) {
        // throw -> bin's parseAsync catch renders `✖ <msg>`, exit 1 (no stack)
        throw new Error(`Could not create branch "${name}": ${e.message}`);
      }
      console.log(chalk.green(`✔ Created and switched to branch ${chalk.bold(name)}`));
      return;
    }

    if (opts.delete) {
      // exact-line match — substring includes() would treat "feature" as merged
      // when only "feature-x" is (audit pass 2 finding 1).
      const merged = (runGit('branch --merged', { allowError: true }) || '')
        .split('\n').map(l => l.replace('*', '').trim()).filter(Boolean);
      const isMerged = merged.includes(opts.delete);
      try {
        if (!isMerged) {
          const { force } = await inquirer.prompt([{ type: 'confirm', name: 'force', message: chalk.yellow(`Branch ${opts.delete} not fully merged. Force delete?`), default: false }]);
          if (!force) { console.log(chalk.yellow('Aborted.')); return; }
          runGit(['branch', '-D', opts.delete]);
        } else {
          runGit(['branch', '-d', opts.delete]);
        }
      } catch (e) {
        throw new Error(`Could not delete branch "${opts.delete}": ${e.message}`);
      }
      console.log(chalk.green(`✔ Deleted branch ${opts.delete}`));
      return;
    }

    if (opts.forceDelete) {
      try {
        runGit(['branch', '-D', opts.forceDelete]);
      } catch (e) {
        throw new Error(`Could not force-delete branch "${opts.forceDelete}": ${e.message}`);
      }
      console.log(chalk.green(`✔ Force-deleted ${opts.forceDelete}`));
      return;
    }

    // Fuzzy picker (S4) when --fuzzy or interactive terminal with many branches
    if (opts.fuzzy) {
      const { fuzzyPicker } = require('../utils/picker');
      const out = runGit(opts.all ? 'branch -a' : 'branch', { allowError:true }) || '';
      const branches = out.split('\n').map(l=>l.replace('*','').trim()).filter(Boolean).map(b=>b.replace('remotes/',''));
      const current = getCurrentBranch();
      const picked = await fuzzyPicker(branches.map(b=>({name: b + (b===current?' ← current':''), value:b})), { message:'Branch' });
      if (picked && picked !== current) { try{ runGit(['checkout',picked]); console.log(chalk.green(`✔ Switched to ${picked}`)); }catch(e){ console.error(chalk.red(e.message)); } }
      return;
    }
    // Default: list with smart info
    const current = getCurrentBranch();
    const args = opts.all ? 'branch -a' : 'branch';
    const out = runGit(args);
    console.log(chalk.bold.cyan('▸ smart branches'));
    console.log(chalk.gray('─'.repeat(40)));
    out.split('\n').forEach(line => {
      if (line.startsWith('*')) console.log(chalk.green.bold(line) + chalk.gray(' ← current'));
      else if (line.trim().startsWith('remotes/')) console.log(chalk.gray(line));
      else if (line.trim()) console.log(' ' + line.trim());
    });
    console.log(chalk.gray('─'.repeat(40)));
    console.log(chalk.gray(`Current: ${chalk.green(current)} | Use: ${chalk.cyan('sg branch --create <name>')} or ${chalk.cyan('sg cleanup')}`));
  });

module.exports = branch;
