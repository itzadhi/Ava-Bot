import { defineModule } from '../../structures/Module.js';
import { chatlogComponents } from './components.js';

export const chatlogModule = defineModule({
  name: 'chatlog',
  description: 'Encrypted channel message export, replay, and management module',
  version: '1.0.0',
  components: chatlogComponents
});

export default chatlogModule;
