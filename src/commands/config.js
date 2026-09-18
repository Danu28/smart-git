const { Command } = require('commander');
const chalk = require('chalk');
const { loadAllConfig, setConfig, initConfig, globalConfigPath, repoConfigPath } = require('../utils/config');

const config = new Command('config')
  .description('Manage smart-git config — global + repo (.smartgitrc) (S3)')
  .option('--global', 'use global config (~/.config/smart-git/config.json) instead of repo')
  .option('--list', 'list all config')
  .option('--get <key>', 'get a config value')
  .option('--set <kv>', 'set key=value (e.g. --set ticketRegex=PROJ-\\d+)')
  .option('--unset <key>', 'unset a key')
  .option('--init', 'init repo config with defaults')
  .action((opts) => {
    const useGlobal = !!opts.global;
    if (opts.init) {
      const cfg = initConfig();
      console.log(chalk.green('✔ Initialized .smartgitrc'));
      console.log(chalk.gray(JSON.stringify(cfg,null,2)));
      return;
    }
    if (opts.list) {
      const all = loadAllConfig();
      console.log(chalk.bold.cyan('▸ smart-git config'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log(chalk.gray(`Global: ${globalConfigPath()}`));
      console.log(chalk.gray(`Repo:   ${repoConfigPath()}`));
      console.log(chalk.gray('─'.repeat(40)));
      console.log(JSON.stringify(all, null, 2));
      return;
    }
    if (opts.get) {
      const v = loadAllConfig()[opts.get];
      console.log(v === undefined ? chalk.yellow('(not set)') : String(v));
      return;
    }
    if (opts.set) {
      const eq = opts.set.indexOf('=');
      if (eq === -1) { console.error(chalk.red('✖ --set needs key=value')); process.exit(1); }
      const k = opts.set.slice(0,eq);
      const v = opts.set.slice(eq+1);
      // try JSON parse, fallback string
      let val = v;
      try { val = JSON.parse(v); } catch {}
      setConfig(k, val, { global: useGlobal });
      console.log(chalk.green(`✔ Set ${k}=${JSON.stringify(val)} ${useGlobal?'(global)':'(repo)'}`));
      return;
    }
    if (opts.unset) {
      setConfig(opts.unset, undefined, { global: useGlobal });
      console.log(chalk.green(`✔ Unset ${opts.unset}`));
      return;
    }
    // default: show help + current
    console.log(chalk.bold.cyan('▸ smart-git config'));
    console.log(chalk.gray('Usage: sg config --list | --get <k> | --set k=v | --unset <k> | --init [--global]'));
    const all = loadAllConfig();
    console.log(chalk.gray(JSON.stringify(all,null,2)));
  });

module.exports = config;
