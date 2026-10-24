import fs from 'node:fs';
import path from 'node:path';

function getFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of list) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (!['node_modules', '.git', 'logs', 'cache', '_reference'].includes(item.name)) {
        results = results.concat(getFiles(full));
      }
    } else if (item.isFile() && item.name.endsWith('.js')) {
      results.push(full);
    }
  }
  return results;
}

const targetDirs = ['src', 'tests', 'scripts'];
let modifiedCount = 0;

for (const d of targetDirs) {
  const files = getFiles(d);
  for (const file of files) {
    let content = fs.readFileSync(file, 'utf8');
    const original = content;

    // Direct brand replacements
    content = content.replace(/AVA System Doctor/g, 'AVA System Doctor');
    content = content.replace(/AVA Owner Control/g, 'AVA Owner Control');
    content = content.replace(/AVA Core Telemetry/g, 'AVA Core Telemetry');
    content = content.replace(/created by AVA/g, 'created by AVA');
    content = content.replace(/ensure AVA can speak/g, 'ensure AVA can speak');
    content = content.replace(/AVA • Components V2/g, 'AVA • Components V2');
    content = content.replace(/client_id=ava/g, 'client_id=ava');
    content = content.replace(/AVA Unlocked/g, 'AVA Unlocked');
    content = content.replace(/AVA is currently undergoing/g, 'AVA is currently undergoing');
    content = content.replace(/report to AVA support/g, 'report to AVA support');
    content = content.replace(/accessing AVA/g, 'accessing AVA');
    content = content.replace(/using AVA/g, 'using AVA');
    content = content.replace(/AVA Auto-Role/g, 'AVA Auto-Role');
    content = content.replace(/AVA Auto-Booster/g, 'AVA Auto-Booster');
    content = content.replace(/AVA Clean Restore Wipe/g, 'AVA Clean Restore Wipe');
    content = content.replace(/AVA Restore/g, 'AVA Restore');
    content = content.replace(/AVA Replay/g, 'AVA Replay');
    content = content.replace(/AVA Auto-Recovery/g, 'AVA Auto-Recovery');
    content = content.replace(/Official AVA Announcement/g, 'Official AVA Announcement');
    content = content.replace(/AVA-/g, 'AVA-');
    content = content.replace(/e\.g\. Argoni or Server Assistant/g, 'e.g. AVA or Server Assistant');
    content = content.replace(/AVA Store/g, 'AVA Store');
    content = content.replace(/AVA • Ticket System Logs/g, 'AVA • Ticket System Logs');
    content = content.replace(/AVA background scheduler/g, 'AVA background scheduler');
    content = content.replace(/AVA ShardingManager/g, 'AVA ShardingManager');
    content = content.replace(/AVA brand logo/g, 'AVA brand logo');
    content = content.replace(/AVA Restoration Console/g, 'AVA Restoration Console');
    content = content.replace(/AVA Role Hierarchy Engine/g, 'AVA Role Hierarchy Engine');
    content = content.replace(/AVA Category Architecture Restore/g, 'AVA Category Architecture Restore');
    content = content.replace(/AVA Channel Architecture Restore/g, 'AVA Channel Architecture Restore');
    content = content.replace(/AVA Server Logo Restore/g, 'AVA Server Logo Restore');
    content = content.replace(/AVA Message History Restore/g, 'AVA Message History Restore');
    content = content.replace(/AVA temporary ticket relay/g, 'AVA temporary ticket relay');
    content = content.replace(/AVA temporary channel empty/g, 'AVA temporary channel empty');
    content = content.replace(/AVA is missing required permissions/g, 'AVA is missing required permissions');
    content = content.replace(/permissions to Argoni\./g, 'permissions to AVA.');
    content = content.replace(/AVA bot role is positioned/g, 'AVA bot role is positioned');
    content = content.replace(/Configure modules above, then tap Restore • AVA/g, 'Configure modules above, then tap Restore • AVA');
    content = content.replace(/Base class representing an AVA feature module/g, 'Base class representing an AVA feature module');
    content = content.replace(/Registers an AVA module/g, 'Registers an AVA module');
    content = content.replace(/Unregistered AVA Module/g, 'Unregistered AVA Module');
    content = content.replace(/Registered AVA Module/g, 'Registered AVA Module');
    content = content.replace(/convenience builder function to define a new AVA module/i, 'convenience builder function to define a new AVA module');
    content = content.replace(/AVA's modular architecture/g, "AVA's modular architecture");
    content = content.replace(/Initializes the module with an active Argoni\/Discord client/g, 'Initializes the module with an active AVA/Discord client');
    content = content.replace(/Running AVA System Doctor/g, 'Running AVA System Doctor');

    if (content !== original) {
      fs.writeFileSync(file, content, 'utf8');
      modifiedCount++;
    }
  }
}

console.log(`✅ Fully cleaned and replaced brand in ${modifiedCount} files.`);
