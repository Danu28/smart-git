const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { ensureGitRepo, runGit, getCurrentBranch } = require('../utils/git');

// Unified tidy — replaces clean (untracked) + cleanup (merged) naming debt (D2)
// sg tidy --untracked  => clean logic, sg tidy --merged => cleanup logic
// Keeps sg clean/cleanup as aliases with deprecation warning.
const tidy = new Command('tidy')
  .description('Tidy — unified cleanup: --untracked (git clean) + --merged (prune branches) (replaces clean/cleanup)')
  .option('--untracked', 'clean untracked files (like sg clean)')
  .option('--merged', 'prune merged branches (like sg cleanup)')
  .option('--ignored', 'also include ignored files (with --untracked)')
  .option('--dry-run', 'preview without deleting')
  .option('--yes', 'skip confirmation')
  .option('--force', 'allow deleting protected files (.env, *.pem, ...only with --untracked)')
  .action(async (opts) => {
    ensureGitRepo();
    // default: if no flag, show both previews? but for safety require explicit flag
    if (!opts.untracked && !opts.merged) {
      console.log(chalk.yellow('Use --untracked to clean untracked files or --merged to prune branches.'));
      console.log(chalk.gray('  sg tidy --untracked --dry-run')); 
      console.log(chalk.gray('  sg tidy --merged --dry-run'));
      return;
    }
    if (opts.untracked) {
      const clean = require('./clean');
      // delegate to clean logic with opts mapping
      const fakeOpts = { ignored: !!opts.ignored, dryRun: !!opts.dryRun, yes: !!opts.yes, force: !!opts.force };
      // call clean's action directly by invoking its handler via run
      // Instead, replicate preview quickly:
      const x = opts.ignored ? ' -x' : '';
      const previewRaw = runGit(`clean -n -d${x}`, { allowError: true, raw: true }) || '';
      const files = previewRaw.split('\n').filter(l=>l.startsWith('Would remove ')).map(l=>l.slice('Would remove '.length)).filter(Boolean);
      if (!files.length) { console.log(chalk.green('✔ Nothing untracked to tidy.')); }
      else {
        console.log(chalk.bold.cyan('▸ tidy --untracked'));
        console.log(chalk.gray('─'.repeat(40)));
        console.log(`${chalk.bold('Would delete:')} ${chalk.red(files.length)} file(s)`);
        files.slice(0,20).forEach(f=>console.log(`  ${chalk.gray(f)}`));
        if (files.length>20) console.log(chalk.gray(`  ... and ${files.length-20} more`));
        if (opts.dryRun) { console.log(chalk.yellow('[dry-run] No changes made')); }
        else {
          if (!opts.yes) {
            const { ok } = await inquirer.prompt([{ type:'confirm', name:'ok', message: chalk.red(`Delete ${files.length} untracked file(s)?`), default:false }]);
            if (!ok) { console.log(chalk.yellow('Cancelled.')); return; }
          }
          const PROTECTED = [/^\.env$/, /^\.env\.[\w.-]+$/, /\.pem$/i, /\.key$/i, /^id_rsa/, /credentials/i, /secret/i];
          const isProt = f=> PROTECTED.some(re=>re.test(f.split('/').pop()));
          const prot = files.filter(isProt);
          if (prot.length && !opts.force) { console.error(chalk.red(`✖ ${prot.length} protected file(s) — use --force`)); process.exit(1); }
          runGit(`clean -fd${x}`);
          console.log(chalk.green(`✔ Tidied ${files.length} untracked file(s)`));
        }
      }
    }
    if (opts.merged) {
      const current = getCurrentBranch();
      const mergedRaw = runGit('branch --merged', { allowError: true }) || '';
      const candidates = mergedRaw.split('\n').map(b=>b.replace('*','').trim()).filter(b=>b && b!==current && !['main','master','develop','dev'].includes(b));
      console.log(chalk.bold.cyan('▸ tidy --merged'));
      console.log(chalk.gray('─'.repeat(40)));
      if (!candidates.length) console.log(chalk.green('✔ No merged branches to prune.'));
      else {
        console.log(chalk.bold(`Merged branches (${candidates.length}):`));
        candidates.forEach(b=>console.log(chalk.gray('  • ')+b));
        if (opts.dryRun) { console.log(chalk.yellow('[dry-run] No changes made')); return; }
        if (!opts.yes) { const { ok } = await inquirer.prompt([{ type:'confirm', name:'ok', message:`Delete ${candidates.length} merged branch(es)?`, default:false }]); if(!ok){ console.log(chalk.yellow('Skipped.')); return; } }
        for(const b of candidates){ try{ runGit(['branch','-d',b]); console.log(chalk.green(`  deleted ${b}`)); }catch(e){ console.log(chalk.yellow(`  skip ${b}: ${e.message.slice(0,60)}`)); } }
        console.log(chalk.gray('→ git fetch --prune')); runGit('fetch --prune', {allowError:true});
        console.log(chalk.green.bold('✔ Tidy --merged complete'));
      }
    }
  });

module.exports = tidy;
