const { Command } = require('commander');
const completion = new Command('completion')
  .description('Generate shell completions for smart-git/sg (A3)')
  .argument('[shell]', 'shell: bash|zsh|fish|powershell (default: bash)')
  .action((shell) => {
    const sh = (shell || 'bash').toLowerCase();
    const bins = 'smart-git sg';
    const cmds = 'status log commit branch switch sync undo cleanup diff stash rescue doctor clean continue abort fixup untrack ignore pr why guide resolve tidy config completion init worktree';
    if (sh === 'bash') {
      console.log(`# smart-git bash completion — add to ~/.bashrc:\n#   source <(sg completion bash)`);
      console.log(`_sg_completion() { local cur="${'${COMP_WORDS[COMP_CWORD]}'}"; COMPREPLY=($(compgen -W "${cmds}" -- "$cur")); }; complete -F _sg_completion ${bins}`);
    } else if (sh === 'zsh') {
      console.log(`#compdef sg smart-git`);
      console.log(`_sg() { local -a cmds; cmds=(${cmds.split(' ').map(c=>`'${c}'`).join(' ')}); _describe 'sg' cmds; }; compdef _sg sg smart-git`);
    } else if (sh === 'fish') {
      console.log(`# fish — put in ~/.config/fish/completions/sg.fish`);
      cmds.split(' ').forEach(c=> console.log(`complete -c sg -f -a ${c}`));
    } else if (sh === 'powershell') {
      console.log(`# PowerShell — add to $PROFILE`);
      console.log(`Register-ArgumentCompleter -CommandName sg,smart-git -ParameterName command -ScriptBlock { param($w,$p,$c); @(${cmds.split(' ').map(c=>`'${c}'`).join(',')}) | Where-Object { $_ -like "$w*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_,$_, 'ParameterValue', $_) } }`);
    } else {
      console.error(`Unknown shell "${sh}" — use bash|zsh|fish|powershell`);
      process.exit(1);
    }
  });
module.exports = completion;
