const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { ensureGitRepo, runGit, getCurrentBranch } = require('../utils/git');
const { UserError } = require('../utils/errors');
const { isProtected, DEFAULT_PROTECTED_BRANCHES } = require('../utils/constants');

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
    if (!opts.untracked && !opts.merged) {
      console.log(chalk.yellow('Use --untracked to clean untracked files or --merged to prune branches.'));
      console.log(chalk.gray('  sg tidy --untracked --dry-run'));
      console.log(chalk.gray('  sg tidy --merged --dry-run'));
      return;
    }
    let untrackedDone = false;
    let untrackedCancelled = false;
    if (opts.untracked) {
      const x = opts.ignored ? ' -x' : '';
      const previewRaw = runGit(`clean -n -d${x}`, { allowError: true, raw: true }) || '';
      const files = previewRaw.split('\n').filter(l=>l.startsWith('Would remove ')).map(l=>l.slice('Would remove '.length)).filter(Boolean);
      const protectedFiles = files.filter(isProtected);
      const safe = files.filter(f => !isProtected(f));
      if (!files.length) {
        console.log(chalk.green('✔ Nothing untracked to tidy.'));
      } else {
        console.log(chalk.bold.cyan('▸ tidy --untracked'));
        console.log(chalk.gray('─'.repeat(40)));
        console.log(`${chalk.bold('Untracked')}${opts.ignored ? ' (incl. ignored)' : ''}: ${chalk.red(files.length)} file(s)`);
        if (safe.length) {
          console.log(chalk.bold('Would delete:'));
          safe.slice(0,20).forEach(f=>console.log(`  ${chalk.gray(f)}`));
          if (safe.length>20) console.log(chalk.gray(`  ... and ${safe.length-20} more`));
        }
        if (protectedFiles.length) {
          console.log(chalk.bold('🛡 Protected (never deleted without --force):'));
          protectedFiles.forEach(f=>console.log(`  ${chalk.yellow(f)}`));
        }
        if (opts.dryRun) {
          console.log(chalk.yellow('[dry-run] No changes made'));
        } else {
          if (protectedFiles.length && !opts.force) {
            throw new UserError(`Aborting: ${protectedFiles.length} protected file(s) may contain secrets. Re-run with --force after verifying.`);
          }
          if (opts.force && protectedFiles.length) {
            console.log(chalk.yellow(`  --force: deleting ${protectedFiles.length} protected file(s) as requested`));
          }
          if (!opts.yes) {
            const { ok } = await inquirer.prompt([{ type:'confirm', name:'ok', message: chalk.red(`Delete ${files.length} untracked file(s)? (irreversible)`), default:false }]);
            if (!ok) {
              console.log(chalk.yellow('Cancelled — untracked not deleted.'));
              untrackedCancelled = true;
            } else {
              runGit(`clean -fd${x}`);
              console.log(chalk.green(`✔ Tidied ${files.length} untracked file(s)`));
              untrackedDone = true;
            }
          } else {
            runGit(`clean -fd${x}`);
            console.log(chalk.green(`✔ Tidied ${files.length} untracked file(s)`));
            untrackedDone = true;
          }
        }
      }
      // if dryRun, we still continue to --merged handling below
    }
    if (opts.merged) {
      const current = getCurrentBranch();
      const mergedRaw = runGit('branch --merged', { allowError: true }) || '';
      const candidates = mergedRaw.split('\n').map(b=>b.replace('*','').trim()).filter(b=>b && b!==current && !DEFAULT_PROTECTED_BRANCHES.includes(b));
      console.log(chalk.bold.cyan('▸ tidy --merged'));
      console.log(chalk.gray('─'.repeat(40)));
      if (!candidates.length) {
        console.log(chalk.green('✔ No merged branches to prune.'));
      } else {
        console.log(chalk.bold(`Merged branches (${candidates.length}):`));
        candidates.forEach(b=>console.log(chalk.gray('  • ')+b));
        if (opts.dryRun) {
          console.log(chalk.yellow('[dry-run] No changes made'));
        } else {
          if (!opts.yes) {
            const { ok } = await inquirer.prompt([{ type:'confirm', name:'ok', message:`Delete ${candidates.length} merged branch(es)?`, default:false }]);
            if(!ok){ console.log(chalk.yellow('Skipped merged pruning.')); }
            else {
              for(const b of candidates){ try{ runGit(['branch','-d',b]); console.log(chalk.green(`  deleted ${b}`)); }catch(e){ console.log(chalk.yellow(`  skip ${b}: ${e.message.slice(0,60)}`)); } }
              console.log(chalk.gray('→ git fetch --prune')); runGit('fetch --prune', {allowError:true});
              console.log(chalk.green.bold('✔ Tidy --merged complete'));
            }
          } else {
            for(const b of candidates){ try{ runGit(['branch','-d',b]); console.log(chalk.green(`  deleted ${b}`)); }catch(e){ console.log(chalk.yellow(`  skip ${b}: ${e.message.slice(0,60)}`)); } }
            console.log(chalk.gray('→ git fetch --prune')); runGit('fetch --prune', {allowError:true});
            console.log(chalk.green.bold('✔ Tidy --merged complete'));
          }
        }
      }
    }
  });

module.exports = tidy;
