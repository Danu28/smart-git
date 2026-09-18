const { Command } = require('commander');
const chalk = require('chalk');
const { ensureGitRepo, runGit } = require('../utils/git');
const { UserError } = require('../utils/errors');

const why = new Command('why')
  .description('Explain who wrote a file or a specific line — blame without the wall (improves `git blame` + `git log -L`)')
  .argument('<file[:line]>', 'file, or file:line (e.g. sg why src/foo.js:12)')
  .option('--explain', 'plain-English summary of the line/file history (AU2)')
  .option('--ai', 'alias for --explain')
  .action((target, opts) => {
    const explain = opts && (opts.explain || opts.ai);
    ensureGitRepo();

    let file = target;
    let line = null;
    const ci = String(target).lastIndexOf(':');
    if (ci > 0 && /^\d+$/.test(String(target).slice(ci + 1))) {
      file = String(target).slice(0, ci);
      line = parseInt(String(target).slice(ci + 1), 10);
    }

    const tracked = runGit(['ls-files', '--error-unmatch', '--', file], { allowError: true }) !== null;
    if (!tracked) {
      throw new UserError(`"${file}" is not a tracked file.`);
    }

    console.log(chalk.bold.cyan('▸ smart why: ') + chalk.white(file) + (line ? chalk.gray(`:${line}`) : ''));
    console.log(chalk.gray('─'.repeat(40)));

    if (line) {
      const blame = runGit(['blame', '-L', `${line},${line}`, '--', file], { allowError: true });
      if (!blame || !blame.trim()) {
        throw new UserError(`Line ${line} is out of range for ${file}.`);
      }
      const first = blame.split('\n')[0];
      const sha = (first.split(' ')[0] || '').slice(0, 7);
      const content = first.includes(') ') ? first.slice(first.indexOf(') ') + 2).trim() : '';
      console.log(`${chalk.bold(`Line ${line}:`)} ${content || chalk.gray('(empty)')}`);
      const meta = sha ? (runGit(['log', '-1', '--pretty=%h|%an|%ad|%s', '--date=short', sha], { allowError: true }) || '') : '';
      if (meta) {
        const [h, an, ad, ...rest] = meta.split('|');
        console.log(`  ${chalk.cyan(h)} ${chalk.gray(an)} ${chalk.gray(`(${ad})`)} ${rest.join('|')}`);
      }
      console.log(chalk.gray('─'.repeat(40)));
      console.log(chalk.bold('History of this line:'));
      const hist = runGit(['log', '--pretty=format:%h %an %ad %s', '--date=short', '-L', `${line},${line}:${file}`], { allowError: true });
      console.log(chalk.gray(hist && hist.trim() ? hist : '(no history — unchanged since it was written)'));
      return;
    }

    console.log(chalk.bold('Top authors:'));
    // explicit HEAD: bare `git shortlog` reads stdin instead of HEAD
    console.log(chalk.gray(runGit(['shortlog', '-sn', 'HEAD', '--', file], { allowError: true }) || '(none)'));
    console.log(chalk.bold('Recent changes:'));
    // format must be quoted: shellSplit would otherwise split "format:%h %an %s"
    // into separate argv → git treats %an/%ad as pathspecs → empty output
    console.log(chalk.gray(runGit(['log', '-3', '--pretty=format:%h %an %ad %s', '--date=short', '--', file], { allowError: true }) || '(none)'));
    if (explain) {
      console.log(chalk.gray('─'.repeat(40)));
      console.log(chalk.bold('Explain:'));
      console.log(chalk.gray('  This file changed for the reasons above; use sg why --explain for AI summary when configured (offline heuristic shown).'));
    }
  });

module.exports = why;