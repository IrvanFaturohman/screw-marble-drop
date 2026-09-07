import { AudioSystem } from './systems/AudioSystem';
import { HapticsSystem } from './systems/HapticsSystem';
import { DebugPanel } from './ui/DebugPanel';

/** App-wide singletons that survive scene restarts. */
export const audio = new AudioSystem();
export const haptics = new HapticsSystem();
export const debugPanel = new DebugPanel();
