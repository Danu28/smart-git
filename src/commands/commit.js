const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { ensureGitRepo, runGit, getDiffSummary, getChangedFiles, gitAddFiles, gitAddPatch } = require('../utils/git');
const { COMMIT_TYPES, smartCommitMessage } = require('../utils/config');
const { inferCommitSuggestion, aiDraftFallback } = require('../utils/infer');

function normalizeArgs(filesArg, optsArg, cmdArg) {
  let files = [];
  let opts = {};
  // commander with .argument('[files...]') -> action(files, opts, command)
  // without files arg, sometimes filesArg is actually opts
  if (Array.isArray(filesArg)) {
    files = filesArg;
    if (optsArg && typeof optsArg.opts === 'function') {
      opts = optsArg.opts();
    } else {
      opts = optsArg || {};
    }
  } else if (filesArg && typeof filesArg === 'object') {
    // no positional files, first arg is opts or Command
    if (typeof filesArg.opts === 'function') {
      opts = filesArg.opts();
    } else {
      opts = filesArg;
    }
    files = [];
    // second arg might be Command instance, ignore
  }
  // also handle case where optsArg is Command
  if (optsArg && typeof optsArg.opts === 'function' && !Array.isArray(filesArg)) {
    // already handled
  }
  if (cmdArg && typeof cmdArg.opts === 'function') {
    const cmdOpts = cmdArg.opts();
    // merge if opts missing keys
    opts = { ...cmdOpts, ...opts };
  }
  // ensure arrays
  if (!Array.isArray(files)) files = [];
  return { files, opts };
}

function formatFileChoices(changedFiles) {
  return changedFiles.map(f => {
    const stagedMark = f.staged ? chalk.yellow('[staged]') : '';
    const unstagedMark = f.unstaged ? chalk.red('[unstaged]') : '';
    const untracked = f.xy === '??' ? chalk.red('[untracked]') : '';
    const status = f.xy.trim() || '??';
    return {
      name: `${status} ${f.file} ${stagedMark}${unstagedMark}${untracked}`.trim(),
      value: f.file,
      checked: true,
    };
  });
}

async function resolveSelectedFiles({ files, opts, changedFiles }) {
  // files from positional args take precedence
  if (files && files.length) {
    // validate: warn if file not in changed list but still allow (user may know)
    const known = new Set(changedFiles.map(f => f.file));
    const unknown = files.filter(f => !known.has(f));
    if (unknown.length) {
      console.log(chalk.yellow(`Note: ${unknown.length} file(s) not in changed list, will try to add anyway: ${unknown.join(', ')}`));
    }
    return files;
  }
  if (opts.all) {
    return changedFiles.map(f => f.file);
  }
  if (opts.patch) {
    // patch mode: still need file selection, but we can select via checkbox first
    // if no file selection, patch all
    if (changedFiles.length === 0) return [];
    const { selected } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selected',
        message: 'Select files for patch staging (space to toggle, enter to confirm):',
        choices: formatFileChoices(changedFiles),
        validate: v => v.length > 0 || 'Select at least one file',
      },
    ]);
    return selected;
  }
  // interactive checkbox for selective commit
  if (changedFiles.length === 0) return [];
  if (changedFiles.length === 1) {
    // single file, auto-select but confirm
    return [changedFiles[0].file];
  }
  const { selected } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selected',
      message: 'Select files to commit (space to toggle, a to toggle all):',
      choices: formatFileChoices(changedFiles),
      validate: v => v.length > 0 || 'Select at least one file',
    },
  ]);
  return selected;
}

function stageFiles(selectedFiles, opts) {
  if (!selectedFiles || !selectedFiles.length) return false;
  if (opts.patch) {
    console.log(chalk.gray(`→ git add -p -- ${selectedFiles.join(' ')}`));
    return gitAddPatch(selectedFiles);
  }
  console.log(chalk.gray(`→ git add -- ${selectedFiles.join(' ')}`));
  return gitAddFiles(selectedFiles);
}

const commit = new Command('commit')
  .description('Smart commit — conventional commits, interactive, auto-stage, selective files (improves `git commit`)')
  .alias('c')
  .argument('[files...]', 'specific files to commit (e.g. sg commit src/foo.js or sg commit -m \"feat: msg\" file1 file2)')
  .option('-m, --message <msg>', 'commit message directly (bypass prompts)')
  .option('-a, --all', 'stage all modified files (overrides selective)')
  .option('-p, --patch', 'interactive patch staging (git add -p)')
  .option('--amend', 'amend last commit')
  .option('--dry-run', 'show what would be committed without committing')
  .option('--no-verify', 'bypass hooks')
  .option('--ai', 'AI draft: infer type/scope/subject from diff (offline heuristic, no network)')
  .action(async (filesArg, optsArg, cmdArg) => {
    const { files, opts } = normalizeArgs(filesArg, optsArg, cmdArg);
    ensureGitRepo();

    // --amend on a repo with no commits: git commit --amend fails with
    // "nothing to amend" — fail cleanly BEFORE any staging (audit pass 2 finding 4).
    if (opts.amend) {
      const count = parseInt(runGit('rev-list --count HEAD', { allowError: true }) || '0', 10);
      if (!count) {
        console.error(chalk.red('✖ Nothing to amend — this repo has no commits yet. Use `sg commit` without --amend.'));
        process.exit(1);
      }
      // Rewriting already-published history needs an explicit second look.
      const onRemote = runGit('branch -r --contains HEAD', { allowError: true }) || '';
      if (onRemote.trim()) {
        const last = runGit('log -1 --oneline', { allowError: true }) || '';
        console.log(chalk.yellow(`⚠ HEAD (${last.trim()}) is on remote branch(es): ${onRemote.trim().split('\n').map(s => s.trim()).join(', ')}`));
        console.log(chalk.yellow('  Amending rewrites history others may have pulled.'));
        const { ok } = await inquirer.prompt([{ type: 'confirm', name: 'ok', message: chalk.red('Amend published commit anyway?'), default: false }]);
        if (!ok) {
          console.log(chalk.yellow('Aborted — nothing amended.'));
          return; // NOT process.exit: keeps the action short-circuiting in-process (tests drive parseAsync)
        }
      }
    }

    const status = runGit('status --porcelain', { allowError: true }) || '';
    if (!status.trim() && !opts.amend) {
      console.log(chalk.yellow('No changes to commit. Working tree clean.'));
      return;
    }

    const changedFiles = getChangedFiles();
    // --ai heuristic (AU2) — offline, no network. Generates draft then prompts for edit.
    let aiDraft = null;
    if (opts.ai) {
      try {
        const branch = require('../utils/git').getCurrentBranch();
        aiDraft = aiDraftFallback(changedFiles, branch);
        if (!opts.message) {
          console.log(chalk.gray(`→ AI draft (heuristic): ${aiDraft.type}${aiDraft.scope?`(${aiDraft.scope})`:''}: ${aiDraft.subject}`));
        }
      } catch {}
    }

    // --- non-interactive -m path with selective support ---
    if (opts.message) {

      if (opts.dryRun) {
        console.log(chalk.cyan('[dry-run] Would commit with message:'));
        console.log(chalk.white(opts.message));
        // Determine what would be committed
        if (files.length) {
          console.log(chalk.gray(`Would stage & commit files: ${files.join(', ')}`));
        } else if (opts.all) {
          console.log(chalk.gray('Would stage all files (git add -A)'));
        } else if (opts.patch) {
          console.log(chalk.gray('Would patch-stage selected files (interactive) — dry-run shows all changed:'));
        }
        const staged = runGit('diff --cached --stat', { allowError: true });
        const unstaged = runGit('diff --stat', { allowError: true });
        const toCommit = files.length ? `Selected: ${files.join(', ')}` : (staged ? staged : '(no staged — would stage per selection)');
        console.log(chalk.gray('Staged would commit:\n' + (staged || '(none)')));
        if (files.length) console.log(chalk.gray(`Selected files: ${files.join(', ')}`));
        else if (unstaged) console.log(chalk.gray('Unstaged (would be staged per selection):\n' + unstaged));
        if (!staged && !unstaged && !files.length) console.log(chalk.yellow('No changes to commit'));
        return;
      }
      // Determine staging for -m path
      if (files.length) {
        // selective files provided
        try {
          if (opts.patch) {
            gitAddPatch(files);
          } else {
            gitAddFiles(files);
          }
        } catch (e) {
          console.error(chalk.red('Failed to stage files:'), e.message);
          return;
        }
      } else if (opts.all) {
        runGit('add -A');
      } else if (opts.patch) {
        // patch without files -> interactive patch all
        gitAddPatch([]);
      } else {
        const staged = runGit('diff --cached --stat', { allowError: true });
        if (!staged) {
          // No staged, need to determine if we should auto-stage all or prompt?
          // For -m without files, preserve legacy auto-stage-all with hint
          console.log(chalk.yellow('No staged changes — staging all (use `sg commit -m \"msg\" <files>` or `git add <file>` to control staging, or --all)'));
          runGit('add -A');
        }
        // else use existing staged
      }
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const tmp = path.join(os.tmpdir(), `smart-git-msg-${Date.now()}.txt`);
      fs.writeFileSync(tmp, opts.message);
      const commitArgs = ['commit', '-F', tmp];
      if (opts.amend) commitArgs.push('--amend');
      if (opts.verify === false) commitArgs.push('--no-verify');
      try {
        runGit(commitArgs, { silent: false });
        console.log(chalk.green('✔ Committed with message:'), opts.message);
        if (files.length) console.log(chalk.gray(`  files: ${files.join(', ')}`));
      } finally {
        try { fs.unlinkSync(tmp); } catch {}
      }
      return;
    }

    // --- Interactive mode with selective file picker ---
    console.log(chalk.bold.cyan('▸ smart-commit — conventional commit builder'));
    console.log(chalk.gray('─'.repeat(40)));
    if (status) {
      const stat = getDiffSummary(false) || getDiffSummary(true) || status.slice(0, 500);
      console.log(chalk.gray('Changes:'));
      console.log(chalk.gray(stat.split('\n').slice(0, 10).join('\n')));
      if (changedFiles.length) {
        console.log(chalk.gray(`\nChanged files (${changedFiles.length}):`));
        changedFiles.slice(0, 20).forEach(f => console.log(chalk.gray(`  ${f.xy} ${f.file}`)));
        if (changedFiles.length > 20) console.log(chalk.gray(`  ... and ${changedFiles.length - 20} more`));
      }
      console.log(chalk.gray('─'.repeat(40)));
    }

    // Minimal happy path: type + subject. Details (scope/body/BREAKING/Closes) are gated
    // behind one confirm — 8 prompts become 4 for the common case, capability unchanged.
    const inferred = (()=>{ try { const b=require('../utils/git').getCurrentBranch(); return inferCommitSuggestion(changedFiles,b); } catch { return {type:'feat',scope:'',subject:''}; } })();
    const aiDefault = aiDraft || inferred;
    if (aiDraft) console.log(chalk.cyan(`  AI draft: ${aiDraft.type}${aiDraft.scope?`(${aiDraft.scope})`:''}: ${aiDraft.subject} (editable)`));
    else if (inferred.subject) console.log(chalk.gray(`  inferred: ${inferred.type}${inferred.scope?`(${inferred.scope})`:''}: ${inferred.subject}`));
    const base = await inquirer.prompt([
      { type: 'list', name: 'type', message: 'Commit type:', choices: COMMIT_TYPES, default: aiDefault.type || 'feat' },
      { type: 'input', name: 'subject', message: 'Subject (short description):', default: aiDefault.subject || '', validate: v => v.length >= 3 && v.length <= 72 || '3-72 chars required' },
    ]);
    let answers = { type: base.type, scope: '', subject: base.subject, body: '', breaking: '', issues: '' };
    const { details } = await inquirer.prompt([
      { type: 'confirm', name: 'details', message: 'Add details? (scope, body, BREAKING change, Closes #)', default: false },
    ]);
    if (details) {
      const extra = await inquirer.prompt([
        { type: 'input', name: 'scope', message: 'Scope (optional, e.g. api, ui):' },
        { type: 'input', name: 'body', message: 'Body (optional, longer description):' },
        { type: 'input', name: 'breaking', message: 'Breaking change (optional):' },
        { type: 'input', name: 'issues', message: 'Closes issues (e.g. #123):' },
      ]);
      answers = { ...answers, ...extra };
    }

    // File selection step — before final confirm
    let selectedFiles = [];
    if (files.length) {
      // positional files provided, use directly without prompt
      selectedFiles = files;
      console.log(chalk.gray(`Selected files (from args): ${selectedFiles.join(', ')}`));
    } else if (opts.all) {
      selectedFiles = changedFiles.map(f => f.file);
      console.log(chalk.gray(`→ --all: staging all ${selectedFiles.length} file(s)`));
    } else if (changedFiles.length === 0) {
      console.log(chalk.yellow('No changed files to select.'));
    } else {
      // interactive checkbox
      // Check if there's already staged content - offer to use staged only or pick
      const stagedStat = runGit('diff --cached --stat', { allowError: true });
      if (stagedStat) {
        const { useStaged } = await inquirer.prompt([
          { type: 'confirm', name: 'useStaged', message: `Found staged changes. Commit only staged? (No = pick files)`, default: true },
        ]);
        if (useStaged) {
          selectedFiles = []; // signal to use staged only, no new add
          console.log(chalk.gray('→ using staged changes only'));
        } else {
          selectedFiles = await resolveSelectedFiles({ files: [], opts, changedFiles });
        }
      } else {
        selectedFiles = await resolveSelectedFiles({ files: [], opts, changedFiles });
      }
    }

    const { confirm } = await inquirer.prompt([{ type: 'confirm', name: 'confirm', message: 'Create commit?', default: true }]);
    if (!confirm) {
      console.log(chalk.yellow('Aborted.'));
      return;
    }

    const fullMessage = smartCommitMessage(answers.type, answers.scope.trim(), answers.subject.trim(), answers.body.trim(), answers.breaking.trim(), answers.issues.trim());

    if (opts.dryRun) {
      console.log(chalk.cyan('\n[Dry-run] Would commit with message:\n'));
      console.log(chalk.white(fullMessage));
      if (selectedFiles.length) console.log(chalk.gray(`\nWould commit files: ${selectedFiles.join(', ')}`));
      else console.log(chalk.gray('\nWould commit staged files'));
      console.log(chalk.gray('(dry-run: no files staged)'));
      return;
    }

    // Staging (only after dry-run check — dry-run must not mutate)
    if (selectedFiles.length) {
      try {
        stageFiles(selectedFiles, opts);
      } catch (e) {
        console.error(chalk.red('Failed to stage selected files:'), e.message);
        return;
      }
    } else if (opts.all) {
      console.log(chalk.gray('→ git add -A'));
      runGit('add -A');
    } else {
      // check if we have staged content (user chose useStaged)
      const staged = runGit('diff --cached --stat', { allowError: true });
      if (!staged) {
        // No staged and no selection -> nothing to commit
        console.log(chalk.yellow('Nothing staged, aborted. Use `sg commit --all` or select files.'));
        return;
      }
      // else keep staged as is
    }

    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const tmp = path.join(os.tmpdir(), `smart-git-${Date.now()}.txt`);
    fs.writeFileSync(tmp, fullMessage);
    const commitArgs2 = ['commit', '-F', tmp];
    if (opts.amend) commitArgs2.push('--amend');
    if (opts.verify === false) commitArgs2.push('--no-verify');
    try {
      runGit(commitArgs2);
      console.log(chalk.green('✔ Committed:'));
      console.log(chalk.white(fullMessage.split('\n')[0]));
      if (selectedFiles.length) console.log(chalk.gray(`  files: ${selectedFiles.join(', ')}`));
      const last = runGit('log -1 --oneline');
      console.log(chalk.gray(last));
    } finally {
      try { fs.unlinkSync(tmp); } catch {}
    }
  });

module.exports = commit;
