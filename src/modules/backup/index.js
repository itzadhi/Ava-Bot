import { defineModule } from '../../structures/Module.js';
import { backupCommand, renderBackupStructure, renderBackupList, renderCentralPanel } from './command.js';
import { backupComponents } from './components.js';
import { createServerBackup } from './creator.js';
import { restoreServerBackup, validateRestorePermissions } from './restorer.js';
import { runIntervalCheck } from '../../services/scheduler.js';

/**
 * Universal Backup Feature Module
 * Complete self-contained module providing server snapshot creation,
 * cross-server restoration, visual project structure inspection,
 * component interaction handlers, and automated interval rotation.
 */
export const backupModule = defineModule({
  name: 'backup',
  description: 'Universal cross-server snapshot, restore, and automated rotation engine',
  version: '1.0.0',
  commands: [backupCommand],
  components: backupComponents,
  cron: [
    {
      expression: '*/15 * * * *',
      run: async (client) => {
        await runIntervalCheck(client);
      }
    }
  ]
});

export {
  createServerBackup,
  restoreServerBackup,
  validateRestorePermissions,
  backupCommand,
  backupComponents,
  renderBackupStructure,
  renderBackupList,
  renderCentralPanel
};

export default backupModule;
