import { defineModule } from '../../structures/Module.js';
import { settingsComponents } from './components.js';

export const settingsModule = defineModule({
  name: 'settings',
  description: 'Centralized server configuration panel and one-tap toggles',
  version: '1.0.0',
  components: settingsComponents
});

export default settingsModule;
