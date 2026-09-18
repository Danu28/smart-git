const inquirer = require('inquirer');

// Shared fuzzy picker primitive — single UI for branch/log/stash/rescue
// Uses inquirer list with pre-filter via input, same keys everywhere:
// type to filter, ↑/↓ to move, enter to select. Preview optional.
function fuzzyFilter(items, query) {
  if (!query) return items;
  const q = query.toLowerCase();
  const scored = items.map((item) => {
    const str = (typeof item === 'string' ? item : item.value || item.name || '').toLowerCase();
    let score = -1;
    if (str === q) score = 3;
    else if (str.startsWith(q)) score = 2;
    else if (str.includes(q)) score = 1;
    return { item, score };
  }).filter(x => x.score >= 0).sort((a,b)=>b.score-a.score).map(x=>x.item);
  return scored.length ? scored : items.filter(i=> {
    const str = (typeof i === 'string' ? i : i.value||i.name||'').toLowerCase();
    return str.includes(q);
  });
}

async function fuzzyPicker(items, opts={}) {
  const { message = 'Pick:', preview, pageSize = 10 } = opts;
  if (!items || !items.length) return null;
  // Step 1: optional filter input
  const { filter } = await inquirer.prompt([{ type: 'input', name: 'filter', message: `${message} (type to filter, empty for all):`, default: '' }]);
  const filtered = fuzzyFilter(items, filter);
  const choices = filtered.slice(0, 30).map(it => {
    if (typeof it === 'string') return { name: it, value: it };
    return it;
  });
  if (preview && filtered.length === 1 && preview[filtered[0]?.value || filtered[0]]) {
    console.log(preview[filtered[0]?.value || filtered[0]]);
  }
  choices.push({ name: '— cancel —', value: null });
  const { selected } = await inquirer.prompt([{ type: 'list', name: 'selected', message: `Select (${filtered.length} matches):`, choices, pageSize }]);
  return selected;
}

module.exports = { fuzzyPicker, fuzzyFilter };
